// 1. Language mapping to ensure correct file extensions
const LANGUAGE_EXTENSIONS = {
    python: "py", python3: "py", cpp: "cpp", c: "c", java: "java",
    csharp: "cs", javascript: "js", typescript: "ts", php: "php",
    swift: "swift", kotlin: "kt", golang: "go", ruby: "rb",
    rust: "rs", scala: "scala", sql: "sql", mysql: "sql",
    mssql: "sql", oraclesql: "sql", html: "html"
};

function utf8ToBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
}
// Helper to pad question ID to 4 digits (e.g., 58 -> "0058")
function padQuestionId(id) {
    return String(id).padStart(4, '0');
}

async function getGithubFileSha(username, repo, token, path) {
    const response = await fetch(`https://api.github.com/repos/${username}/${repo}/contents/${path}`, {
        headers: { "Authorization": `token ${token}` }
    });
    if (response.status === 200) {
        const data = await response.json();
        return data.sha;
    }
    return null;
}

async function pushToGithub(username, repo, token, path, content, message) {
    const sha = await getGithubFileSha(username, repo, token, path);
    const body = {
        message: message,
        content: utf8ToBase64(content)
    };
    if (sha) body.sha = sha;

    await fetch(`https://api.github.com/repos/${username}/${repo}/contents/${path}`, {
        method: "PUT",
        headers: {
            "Authorization": `token ${token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "sync_submission") {
        syncLeetCodeToGitHub(request.slug);
    }
});
// Decodes GitHub's Base64 back into readable text (handling special characters safely)
function base64ToUtf8(str) {
    return decodeURIComponent(escape(atob(str)));
}

async function updateStatsJson(username, repo, token, difficulty, slug) {
    const path = "stats.json";
    let sha = null;
    let stats = { solved: 0, easy: 0, medium: 0, hard: 0, solvedSlugs: [] };

    // 1. Fetch the existing stats.json from GitHub
    const response = await fetch(`https://api.github.com/repos/${username}/${repo}/contents/${path}`, {
        headers: { "Authorization": `token ${token}` }
    });

    if (response.status === 200) {
        const data = await response.json();
        sha = data.sha;
        try {
            stats = JSON.parse(base64ToUtf8(data.content));
        } catch (e) {
            console.error("Failed to parse existing stats.json, starting fresh.");
        }
    }

    // Ensure the array exists (in case you are migrating from an older JSON format)
    if (!stats.solvedSlugs) stats.solvedSlugs = [];

    // 2. Prevent Double-Counting!
    if (stats.solvedSlugs.includes(slug)) {
        console.log(`LeetCode Syncer: ${slug} is already in stats.json. Skipping count update.`);
        return; 
    }

    // 3. Increment the counts
    stats.solvedSlugs.push(slug);
    stats.solved += 1;
    
    const diffLower = difficulty.toLowerCase();
    if (stats[diffLower] !== undefined) {
        stats[diffLower] += 1;
    }

    // 4. Push the updated stats.json back to GitHub
    const body = {
        message: `Stats: Update LeetCode counts for ${slug}`,
        content: utf8ToBase64(JSON.stringify(stats, null, 2))
    };
    if (sha) body.sha = sha;

    const putResponse = await fetch(`https://api.github.com/repos/${username}/${repo}/contents/${path}`, {
        method: "PUT",
        headers: {
            "Authorization": `token ${token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });

    if (putResponse.ok) {
        console.log(`Successfully updated stats.json! New Total: ${stats.solved}`);
    } else {
        console.error("Failed to push stats.json to GitHub");
    }
}

async function updateRootReadme(username, repo, token, question, folderName, difficulty) {
    const path = "README.md";
    let content = "";
    let sha = null;

    const response = await fetch(`https://api.github.com/repos/${username}/${repo}/contents/${path}`, {
        headers: { "Authorization": `token ${token}` }
    });

    if (response.status === 200) {
        const data = await response.json();
        sha = data.sha;
        content = base64ToUtf8(data.content);
    } else {
        content = "# 🧑‍💻 My LeetCode Solutions\n\nThis repository contains my algorithmic solutions, automatically organized by topic.\n";
    }

    let topics = question.topicTags.map(t => t.name);
    if (topics.length === 0) topics = ["Uncategorized"];

    let isModified = false;
    const safeFolder = encodeURIComponent(folderName);
    
    // --- UPDATED: Link points to the difficulty folder inside my-solutions ---
    const entry = `- [${question.title}](./my-solutions/${difficulty}/${safeFolder})`;

    for (let topic of topics) {
        const header = `## ${topic}`;
        if (!content.includes(header)) {
            content += `\n${header}\n${entry}\n`;
            isModified = true;
        } else {
            if (!content.includes(entry)) {
                let parts = content.split(header);
                parts[1] = `\n${entry}` + parts[1];
                content = parts.join(header);
                isModified = true;
            }
        }
    }

    if (isModified) {
        const body = {
            message: `Docs: Update Topic README with ${question.title}`,
            content: utf8ToBase64(content)
        };
        if (sha) body.sha = sha;

        await fetch(`https://api.github.com/repos/${username}/${repo}/contents/${path}`, {
            method: "PUT",
            headers: {
                "Authorization": `token ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });
        console.log("Successfully updated root README.md!");
    }
}

async function syncLeetCodeToGitHub(slug) {
    chrome.storage.local.get(['gh_username', 'gh_repo', 'gh_token'], async (settings) => {
        if (!settings.gh_token || !settings.gh_repo) return;

        try {
            // --- UPDATED: Added 'difficulty' to the GraphQL query ---
            const problemQuery = {
                query: `query getQuestionDetail($titleSlug: String!) {
                  question(titleSlug: $titleSlug) {
                    questionId
                    title
                    difficulty 
                    content
                    topicTags { name }
                  }
                }`,
                variables: { titleSlug: slug }
            };

            const problemRes = await fetch("https://leetcode.com/graphql", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(problemQuery)
            });
            const problemData = await problemRes.json();
            const question = problemData.data.question;
            const difficulty = question.difficulty; // "Easy", "Medium", or "Hard"

            // Get Submission ID
            const submissionListQuery = {
                query: `query submissionList($offset: Int!, $limit: Int!, $questionSlug: String!) {
                  questionSubmissionList(offset: $offset, limit: $limit, questionSlug: $questionSlug) {
                    submissions { id, statusDisplay }
                  }
                }`,
                variables: { offset: 0, limit: 5, questionSlug: slug }
            };

            const subListRes = await fetch("https://leetcode.com/graphql", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(submissionListQuery)
            });
            const subListData = await subListRes.json();
            const acceptedSub = subListData.data.questionSubmissionList.submissions.find(sub => sub.statusDisplay === "Accepted");
            
            if (!acceptedSub) return;

            // Get Code
            const codeQuery = {
                query: `query submissionDetails($submissionId: Int!) {
                  submissionDetails(submissionId: $submissionId) { code, lang { name } }
                }`,
                variables: { submissionId: parseInt(acceptedSub.id) }
            };

            const codeRes = await fetch("https://leetcode.com/graphql", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(codeQuery)
            });
            const codeData = await codeRes.json();
            const langCode = codeData.data.submissionDetails.lang.name;
            const codeContent = codeData.data.submissionDetails.code;
            const fileExtension = LANGUAGE_EXTENSIONS[langCode] || "txt";

            // --- UPDATED: Target Directory is now based on Difficulty ---
            const paddedId = padQuestionId(question.questionId);
            const folderName = `${paddedId}-${slug}`;
            const targetDir = `my-solutions/${difficulty}/${folderName}`;
            
            let topicsStr = question.topicTags.map(t => t.name).join(", ");
            // Added Difficulty to README for good measure
            const readmeContent = `# ${question.title}\n\n### Difficulty: ${difficulty}\n### Topics: ${topicsStr}\n\n${question.content}`;

            await pushToGithub(settings.gh_username, settings.gh_repo, settings.gh_token, `${targetDir}/README.md`, readmeContent, `Docs: Add description for ${question.title}`);
            await pushToGithub(settings.gh_username, settings.gh_repo, settings.gh_token, `${targetDir}/solution.${fileExtension}`, codeContent, `Code: Add ${langCode} solution for ${question.title}`);
            
            // Pass difficulty to the README updater
            await updateRootReadme(settings.gh_username, settings.gh_repo, settings.gh_token, question, folderName, difficulty);

            await updateStatsJson(settings.gh_username, settings.gh_repo, settings.gh_token, difficulty, slug);
        } catch (error) {
            console.error("Error syncing to GitHub:", error);
        }
    });
}