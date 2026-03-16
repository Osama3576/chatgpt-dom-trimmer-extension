(() => {
  // Default extension settings.
  const DEFAULT_SETTINGS = {
    enabled: true,
    keepAssistantReplies: 2,
    preservePrompt: true,
    showBadge: true,
  };

  // Runtime state used by the content script.
  const STATE = {
    settings: { ...DEFAULT_SETTINGS },
    observer: null,
    routeTimer: null,
    applyTimer: null,
    badgeTimer: null,
    removedCount: 0,
    lastUrl: location.href,
    badge: null,
    hasStarted: false,
    queuedBadge: null,
  };

  // Debounce trimming so we do not run heavy DOM work too often.
  function debounceApply(delay = 180) {
    clearTimeout(STATE.applyTimer);
    STATE.applyTimer = setTimeout(() => {
      applyTrimming().catch(error => {
        console.error('[ChatGPT DOM Trimmer] Apply failed:', error);
      });
    }, delay);
  }

  // Create the floating badge only once.
  function createBadge() {
    let badge = document.getElementById('chatgpt-dom-trimmer-badge');
    if (badge) return badge;

    badge = document.createElement('div');
    badge.id = 'chatgpt-dom-trimmer-badge';
    badge.style.cssText = [
      'position:fixed',
      'right:18px',
      'bottom:18px',
      'z-index:2147483647',
      'background:rgba(34,197,94,0.96)',
      'color:#ffffff',
      'border:1px solid rgba(255,255,255,0.16)',
      'border-radius:999px',
      'padding:8px 12px',
      'font:12px/1.2 Arial,sans-serif',
      'backdrop-filter:blur(10px)',
      'box-shadow:0 8px 28px rgba(0,0,0,0.25)',
      'pointer-events:none',
      'display:none',
    ].join(';');

    document.documentElement.appendChild(badge);
    return badge;
  }

  // Hide the badge without removing the element.
  function hideBadge(clearQueuedBadge = false) {
    clearTimeout(STATE.badgeTimer);
    STATE.badgeTimer = null;

    if (!STATE.badge) {
      STATE.badge = document.getElementById(
        'chatgpt-dom-trimmer-badge',
      );
    }

    if (STATE.badge) {
      STATE.badge.style.display = 'none';
    }

    if (clearQueuedBadge) {
      STATE.queuedBadge = null;
    }
  }

  // Render the badge immediately.
  function renderBadge(text) {
    STATE.badge = STATE.badge || createBadge();
    STATE.badge.textContent = text;
    STATE.badge.style.display = 'block';
  }

  // Show a badge for a limited duration.
  // If another badge is already visible, keep only the latest queued message.
  function showTemporaryBadge(text, duration = 3000) {
    if (!STATE.settings.showBadge) return;

    if (STATE.badgeTimer) {
      STATE.queuedBadge = { text, duration };
      return;
    }

    renderBadge(text);

    STATE.badgeTimer = setTimeout(() => {
      hideBadge();

      // Show the latest queued badge after the current one disappears.
      if (STATE.queuedBadge) {
        const nextBadge = STATE.queuedBadge;
        STATE.queuedBadge = null;
        showTemporaryBadge(nextBadge.text, nextBadge.duration);
      }
    }, duration);
  }

  // Show the startup badge after a full page load.
  function showStartupBadge() {
    if (!STATE.settings.enabled || !STATE.settings.showBadge) return;
    showTemporaryBadge('Chat Trimmer is Working', 3000);
  }

  // Fully remove the badge if the extension is disabled.
  function removeBadge() {
    clearTimeout(STATE.badgeTimer);
    STATE.badgeTimer = null;
    STATE.queuedBadge = null;

    const badge = document.getElementById(
      'chatgpt-dom-trimmer-badge',
    );
    if (badge) badge.remove();

    STATE.badge = null;
  }

  // Load latest settings from extension storage.
  async function loadSettings() {
    const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
    STATE.settings = { ...DEFAULT_SETTINGS, ...stored };
  }

  // Try the main ChatGPT turn selector first, then fall back to role-based containers.
  function getTurnNodes() {
    const byArticle = [
      ...document.querySelectorAll(
        'article[data-testid^="conversation-turn-"]',
      ),
    ];
    if (byArticle.length) return byArticle;

    const roleContainers = [
      ...document.querySelectorAll('[data-message-author-role]'),
    ]
      .map(node => node.closest('article, li, section, div'))
      .filter(Boolean);

    const unique = [];
    const seen = new Set();

    for (const node of roleContainers) {
      if (!seen.has(node)) {
        seen.add(node);
        unique.push(node);
      }
    }

    return unique;
  }

  // Detect whether a turn belongs to the assistant or the user.
  function getRoleForTurn(turn, fallbackIndex) {
    const directRole = turn.getAttribute?.(
      'data-message-author-role',
    );
    if (directRole === 'assistant' || directRole === 'user') {
      return directRole;
    }

    const nestedRoleNode = turn.querySelector?.(
      '[data-message-author-role]',
    );
    const nestedRole = nestedRoleNode?.getAttribute?.(
      'data-message-author-role',
    );
    if (nestedRole === 'assistant' || nestedRole === 'user') {
      return nestedRole;
    }

    const srOnly = (
      turn.querySelector?.('h6.sr-only')?.textContent || ''
    ).toLowerCase();
    if (srOnly.includes('chatgpt') || srOnly.includes('assistant')) {
      return 'assistant';
    }
    if (srOnly.includes('you') || srOnly.includes('user')) {
      return 'user';
    }

    const testId = turn.getAttribute?.('data-testid') || '';
    const match = /conversation-turn-(\d+)/.exec(testId);
    if (match) {
      return Number(match[1]) % 2 === 0 ? 'user' : 'assistant';
    }

    // Final fallback if no reliable marker is found.
    return fallbackIndex % 2 === 0 ? 'user' : 'assistant';
  }

  // Calculate from which index old turns should be removed.
  function getCutoffIndex(turns, roles) {
    const assistantIndexes = [];

    for (let i = 0; i < roles.length; i += 1) {
      if (roles[i] === 'assistant') assistantIndexes.push(i);
    }

    if (!assistantIndexes.length) return 0;
    if (
      assistantIndexes.length <= STATE.settings.keepAssistantReplies
    ) {
      return 0;
    }

    const keptAssistantIndexes = assistantIndexes.slice(
      -STATE.settings.keepAssistantReplies,
    );
    let cutoffIndex = keptAssistantIndexes[0];

    // Optionally preserve the user prompt that belongs to the first kept assistant reply.
    if (!STATE.settings.preservePrompt) return cutoffIndex;

    for (let i = cutoffIndex - 1; i >= 0; i -= 1) {
      if (roles[i] === 'user') {
        cutoffIndex = i;
        break;
      }
    }

    return cutoffIndex;
  }

  // Remove old turn nodes from the DOM.
  function removeOldTurns(turns, cutoffIndex) {
    let removed = 0;

    for (let i = 0; i < cutoffIndex; i += 1) {
      const turn = turns[i];
      if (!turn?.isConnected) continue;
      turn.remove();
      removed += 1;
    }

    return removed;
  }

  // Show a short badge only when something was actually trimmed.
  function updateStatus(removedNow) {
    STATE.removedCount += removedNow;

    if (!STATE.settings.enabled) {
      removeBadge();
      return;
    }

    // Do not show the trim badge when nothing was removed.
    if (removedNow <= 0) return;

    // Keep the text short and show it for 3 seconds.
    showTemporaryBadge(`Trimmed Responses ${removedNow}`, 3000);
  }

  // Main trimming routine.
  async function applyTrimming() {
    await loadSettings();

    if (!STATE.settings.enabled) {
      removeBadge();
      return { ok: true, removedCount: 0, disabled: true };
    }

    const turns = getTurnNodes();
    if (!turns.length) {
      return { ok: true, removedCount: 0 };
    }

    const roles = turns.map((turn, index) =>
      getRoleForTurn(turn, index),
    );
    const cutoffIndex = getCutoffIndex(turns, roles);

    if (cutoffIndex <= 0) {
      return { ok: true, removedCount: 0 };
    }

    const removedNow = removeOldTurns(turns, cutoffIndex);
    updateStatus(removedNow);

    return { ok: true, removedCount: removedNow };
  }

  // Watch for DOM changes so newly added messages can be trimmed automatically.
  function startObserver() {
    if (STATE.observer) return;

    STATE.observer = new MutationObserver(mutations => {
      // Ignore badge-related mutations to avoid triggering ourselves.
      const hasRelevantMutation = mutations.some(mutation => {
        const nodes = [
          ...mutation.addedNodes,
          ...mutation.removedNodes,
        ];

        return nodes.some(node => {
          if (!(node instanceof HTMLElement)) return false;
          if (node.id === 'chatgpt-dom-trimmer-badge') return false;
          if (node.closest?.('#chatgpt-dom-trimmer-badge')) {
            return false;
          }
          return true;
        });
      });

      if (hasRelevantMutation) debounceApply();
    });

    STATE.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  // Watch route changes because ChatGPT navigation often happens without full reloads.
  function startRouteWatcher() {
    if (STATE.routeTimer) return;

    STATE.routeTimer = window.setInterval(() => {
      if (location.href !== STATE.lastUrl) {
        STATE.lastUrl = location.href;
        STATE.removedCount = 0;
        hideBadge(true);
        debounceApply(250);
      }
    }, 700);
  }

  // Allow manual apply from popup or background scripts.
  chrome.runtime.onMessage.addListener(
    (message, _sender, sendResponse) => {
      if (message?.type === 'CHATGPT_DOM_TRIMMER_APPLY') {
        applyTrimming()
          .then(result => sendResponse(result))
          .catch(error => {
            console.error(
              '[ChatGPT DOM Trimmer] Manual apply failed:',
              error,
            );
            sendResponse({ ok: false, error: String(error) });
          });

        return true;
      }

      return false;
    },
  );

  // Re-apply trimming whenever extension settings change.
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    const relevantKeys = [
      'enabled',
      'keepAssistantReplies',
      'preservePrompt',
      'showBadge',
    ];
    const hasRelevantChange = relevantKeys.some(
      key => key in changes,
    );
    if (!hasRelevantChange) return;

    STATE.removedCount = 0;
    hideBadge(true);
    debounceApply(50);
  });

  // Start everything once.
  async function init() {
    if (STATE.hasStarted) return;
    STATE.hasStarted = true;

    await loadSettings();
    showStartupBadge();
    startObserver();
    startRouteWatcher();
    debounceApply(200);
  }

  init().catch(error => {
    console.error('[ChatGPT DOM Trimmer] Init failed:', error);
  });
})();
