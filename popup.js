const DEFAULT_SETTINGS = {
  enabled: true,
  keepAssistantReplies: 2,
  preservePrompt: true,
};

const els = {
  enabled: document.getElementById('enabled'),
  keepCount: document.getElementById('keepCount'),
  preservePrompt: document.getElementById('preservePrompt'),
  applyBtn: document.getElementById('applyBtn'),
  reloadBtn: document.getElementById('reloadBtn'),
  statusText: document.getElementById('statusText'),
  quickButtons: [...document.querySelectorAll('.quick')],
};

async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function saveSettings(partial) {
  await chrome.storage.local.set(partial);
  return getSettings();
}

async function getActiveChatTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  const tab = tabs[0];
  if (!tab?.id) return null;
  return tab;
}

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
      setStatus(`Applied on current chat.${removedText}`);
    } else {
      setStatus('Open a ChatGPT conversation tab first.');
    }
  } catch (error) {
    setStatus('Open a ChatGPT conversation tab first.');
  }
}

function setStatus(text) {
  els.statusText.textContent = text;
}

function sanitizeCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed))
    return DEFAULT_SETTINGS.keepAssistantReplies;
  return Math.max(1, Math.min(50, Math.floor(parsed)));
}

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

els.applyBtn.addEventListener('click', applyFromUi);
els.enabled.addEventListener('change', applyFromUi);
els.preservePrompt.addEventListener('change', applyFromUi);

els.keepCount.addEventListener('keydown', async event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    await applyFromUi();
  }
});

for (const button of els.quickButtons) {
  button.addEventListener('click', async () => {
    els.keepCount.value = button.dataset.value;
    await applyFromUi();
  });
}

els.reloadBtn.addEventListener('click', async () => {
  const tab = await getActiveChatTab();
  if (!tab?.id) {
    setStatus('Active tab not found.');
    return;
  }
  await chrome.tabs.reload(tab.id);
  setStatus('Chat reloaded.');
});

hydrate();
