// Add after existing imports
const parseSearchWithClaude = async (query) => {
    try {
        console.log('\n[Claude API] Parsing query:', query);
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                messages: [{
                    role: 'user',
                    content: `Extract search keywords from this movie query: "${query}". Return only key terms as comma-separated list, no explanation.`
                }],
                model: 'claude-3-haiku-20240307',
                max_tokens: 100
            })
        });
        const data = await response.json();
        const keywords = data.content.split(',').map(k => k.trim());
        console.log('[Claude API] Extracted keywords:', keywords);
        return keywords;
    } catch (error) {
        console.error('[Claude API] Error:', error);
        return query.split(' ');
    }
};