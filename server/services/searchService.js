import { search } from 'duck-duck-scrape';

/**
 * Performs a web search and returns a summarized string of results.
 */
export const performWebSearch = async (query) => {
    try {
        console.log(`Searching the web for: ${query}...`);
        const searchResults = await search(query, {
            safeSearch: 1 // Moderate
        });

        if (!searchResults || !searchResults.results || searchResults.results.length === 0) {
            return "No web results found for this query.";
        }

        // Take the top 4 results and format them
        const topResults = searchResults.results.slice(0, 4).map(res => {
            return `Title: ${res.title}
Snippet: ${res.description}
Source: ${res.url}
`;
        }).join('\n---\n');

        return `Top Web Results for "${query}":

${topResults}`;
    } catch (error) {
        console.error("Web Search Error:", error);
        return "Sorry, I encountered an error while searching the web.";
    }
};