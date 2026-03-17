// Default popup settings used when nothing is stored yet.
const DEFAULT_SETTINGS = {
  enabled: true,
  keepAssistantReplies: 2,
  preservePrompt: true,
};

// Cached DOM references for the popup UI.
const els = {
  enabled: document.getElementById('enabled'),
  keepCount: document.getElementById('keepCount'),
  preservePrompt: document.getElementById('preservePrompt'),
  applyBtn: document.getElementById('applyBtn'),
  reloadBtn: document.getElementById('reloadBtn'),
  statusText: document.getElementById('statusText'),
  quickButtons: [...document.querySelectorAll('.quick')],
};

// Read the latest saved settings from extension storage.
async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

// Save only the changed settings, then return the merged result.
async function saveSettings(partial) {
  await chrome.storage.local.set(partial);
  return getSettings();
}

// Get the currently active browser tab.
async function getActiveChatTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  const tab = tabs[0];
  if (!tab?.id) return null;
  return tab;
}

// Send a manual apply request to the active ChatGPT tab.
async function sendApplyMessage() {
  const tab = await getActiveChatTab();
  if (!tab?.id) {
    setStatus('Active tab not found.');
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'CHATGPT_DOM_TRIMMER_APPLY',
    });

    if (response?.ok) {
      const removedText =
        typeof response.removedCount === 'number'
          ? ` Removed ${response.removedCount} turn(s).`
          : '';
      setStatus(`Applied to the current chat.${removedText}`);
    } else {
      setStatus('Open a ChatGPT conversation tab first.');
    }
  } catch (error) {
    setStatus('Open a ChatGPT conversation tab first.');
  }
}

// Update the popup status line.
function setStatus(text) {
  els.statusText.textContent = text;
}

// Normalize the user-provided reply count.
function sanitizeCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_SETTINGS.keepAssistantReplies;
  }
  return Math.max(1, Math.min(50, Math.floor(parsed)));
}

// Load saved settings into the popup controls.
async function hydrate() {
  const settings = await getSettings();
  els.enabled.checked = settings.enabled;
  els.keepCount.value = settings.keepAssistantReplies;
  els.preservePrompt.checked = settings.preservePrompt;

  setStatus(
    settings.enabled
      ? 'Live trimming is enabled.'
      : 'Live trimming is disabled.',
  );
}

// Save the current popup values and apply them to the active chat.
async function applyFromUi() {
  const newSettings = {
    enabled: els.enabled.checked,
    keepAssistantReplies: sanitizeCount(els.keepCount.value),
    preservePrompt: els.preservePrompt.checked,
  };

  els.keepCount.value = newSettings.keepAssistantReplies;
  await saveSettings(newSettings);
  await sendApplyMessage();
}

// Apply settings when the main controls are used.
els.applyBtn.addEventListener('click', applyFromUi);
els.enabled.addEventListener('change', applyFromUi);
els.preservePrompt.addEventListener('change', applyFromUi);

// Apply settings when the user presses Enter inside the number input.
els.keepCount.addEventListener('keydown', async event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    await applyFromUi();
  }
});

// Support quick preset buttons for common values.
for (const button of els.quickButtons) {
  button.addEventListener('click', async () => {
    els.keepCount.value = button.dataset.value;
    await applyFromUi();
  });
}

// Reload the active chat to restore the full conversation from the page load.
els.reloadBtn.addEventListener('click', async () => {
  const tab = await getActiveChatTab();
  if (!tab?.id) {
    setStatus('Active tab not found.');
    return;
  }

  await chrome.tabs.reload(tab.id);
  setStatus('Chat reloaded.');
});

// Initialize the popup.
hydrate();
