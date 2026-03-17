# ChatGPT DOM Trimmer

A small Chrome extension that keeps only the latest **N assistant replies** in the ChatGPT web UI. Older turns are removed from the current page DOM so very long chats stay lighter and more responsive.

## What it does

- Lets the user choose how many recent ChatGPT replies should stay visible.
- Watches the page live with a `MutationObserver`.
- Automatically trims older turns as soon as the conversation grows past the selected limit.
- Optionally keeps the matching user prompts with those replies.
- Shows a small on-page status badge.

## Important behavior

- Older turns are removed from the **current loaded page view**.
- Reload the conversation to restore the full chat.
- This improves DOM and rendering weight, but it does not change anything stored by ChatGPT on the server.

## Install

1. Open `chrome://extensions/`
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this extension folder.
5. Open a ChatGPT conversation.
6. Set the number of replies to keep from the extension popup.

## Files

- `manifest.json`
- `popup.html`
- `popup.css`
- `popup.js`
- `content.js`
