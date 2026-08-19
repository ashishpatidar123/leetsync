document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get(['gh_username', 'gh_repo', 'gh_token'], (data) => {
        if (data.gh_username) document.getElementById('username').value = data.gh_username;
        if (data.gh_repo) document.getElementById('repo').value = data.gh_repo;
        if (data.gh_token) document.getElementById('token').value = data.gh_token;
    });

    document.getElementById('saveBtn').addEventListener('click', () => {
        const username = document.getElementById('username').value.trim();
        const repo = document.getElementById('repo').value.trim();
        const token = document.getElementById('token').value.trim();
        const status = document.getElementById('status');

        if (!username || !repo || !token) {
            status.textContent = "All fields are required!";
            status.style.color = "#d73a49";
            return;
        }

        chrome.storage.local.set({
            gh_username: username,
            gh_repo: repo,
            gh_token: token
        }, () => {
            status.textContent = "Saved successfully!";
            status.style.color = "#2ea44f";
            setTimeout(() => { status.textContent = ""; }, 2000);
        });
    });
});