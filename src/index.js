// index.js
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-core');
const chromium = require('chrome-aws-lambda');

// --- Type Definitions ---
/**
 * @typedef {Object} SearchResult
 * @property {string} title
 * @property {string} manga_id
 * @property {string} image
 * @property {string} latest_chapter
 * @property {string} rating
 */

/**
 * @typedef {Object} ChapterImage
 * @property {number} pageNumber
 * @property {string} imageUrl
 */

/**
 * @typedef {Object} ChapterData
 * @property {string} title
 * @property {ChapterImage[]} images
 * @property {string|null} prev_chapter
 * @property {string|null} next_chapter
 */

/**
 * @typedef {Object} MangaDetail
 * @property {string} title
 * @property {string} image
 * @property {string} description
 * @property {string} author
 * @property {string[]} genres
 * @property {string} rating
 * @property {Array<{number: string, title: string, url: string, uploadDate: string}>} chapters
 */

// --- Utility function for delays ---
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Initialize Express app
const app = express();

// Apply middleware
app.use(express.json());
app.use(cors());  // Enable CORS for all routes

// Configure custom CORS headers for more control if needed
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Max-Age', '86400');
  next();
});

// Handle preflight requests
app.options('*', (req, res) => {
  res.status(204).end();
});

// Helper function to launch browser with proper configuration for Vercel
async function launchBrowser() {
  // Use the Chrome binary provided by Vercel in production or fallback to local executable
  const executablePath = process.env.NODE_ENV === 'production'
    ? await chrome.executablePath
    : process.env.CHROME_PATH || undefined;
  
  return puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });
}

/**
 * Scrape manga details using Puppeteer
 * @param {string} mangaUrl - URL of the manga to scrape
 * @returns {Promise<MangaDetail>} - Manga details
 */
async function scrapeMangaDetails(mangaUrl) {
  const browser = await launchBrowser();
  
  try {
    const page = await browser.newPage();
    
    // Set viewport size
    await page.setViewport({ width: 1280, height: 800 });
    
    // Set user agent to avoid detection
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    // Navigate to manga page
    await page.goto(mangaUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // Wait for the content to load
    await page.waitForSelector('.manga-container', { timeout: 30000 });
    
    // Extract manga details
    const mangaDetails = await page.evaluate(() => {
      const title = document.querySelector('.manga-title')?.textContent?.trim() || 'Unknown Title';
      const description = document.querySelector('.manga-description')?.textContent?.trim() || 'No description available';
      
      // Get author information
      const author = document.querySelector('.author-name')?.textContent?.trim() || 'Unknown Author';
      
      // Get genres
      const genreElements = document.querySelectorAll('.genre-tag');
      const genres = Array.from(genreElements).map(el => el.textContent.trim());
      
      // Get rating
      const rating = document.querySelector('.rating-value')?.textContent?.trim() || 'No rating';
      
      // Get cover image URL
      const coverImage = document.querySelector('.cover-image')?.getAttribute('src') || null;
      
      // Get chapters
      const chapterElements = document.querySelectorAll('.chapter-item');
      const chapters = Array.from(chapterElements).map(el => {
        return {
          number: el.querySelector('.chapter-number')?.textContent?.trim() || 'Unknown',
          title: el.querySelector('.chapter-title')?.textContent?.trim() || 'No title',
          uploadDate: el.querySelector('.upload-date')?.textContent?.trim() || 'Unknown date',
          url: el.querySelector('a')?.getAttribute('href') || '#'
        };
      });
      
      return {
        title,
        image: coverImage,
        description,
        author,
        genres,
        rating,
        chapters
      };
    });
    
    return mangaDetails;
  } catch (error) {
    console.error('Error scraping manga:', error);
    throw new Error(`Failed to scrape manga: ${error.message}`);
  } finally {
    await browser.close();
  }
}

/**
 * Search for manga
 * @param {string} searchTerm - Term to search for
 * @returns {Promise<SearchResult[]>} - List of search results
 */
async function searchManga(searchTerm) {
  const browser = await launchBrowser();
  
  try {
    const page = await browser.newPage();
    
    // Set viewport size
    await page.setViewport({ width: 1280, height: 800 });
    
    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    // Navigate to search page
    const searchUrl = `https://mangadex.org/search?q=${encodeURIComponent(searchTerm)}`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // Wait for search results to load
    await page.waitForSelector('.manga-card', { timeout: 30000 });
    
    // Extract search results
    const searchResults = await page.evaluate(() => {
      const resultElements = document.querySelectorAll('.manga-card');
      
      return Array.from(resultElements).map(el => {
        const title = el.querySelector('.manga-title')?.textContent?.trim() || 'Unknown Title';
        const url = el.querySelector('a')?.getAttribute('href') || '#';
        const thumbnail = el.querySelector('.thumbnail')?.getAttribute('src') || null;
        const latestChapter = el.querySelector('.latest-chapter')?.textContent?.trim() || '';
        const rating = el.querySelector('.rating')?.textContent?.trim() || '';
        
        let mangaId = '';
        const match = url.match(/title\/(.*?)\/?$/);
        if (match) {
          mangaId = match[1];
        }
        
        return {
          title,
          manga_id: mangaId,
          image: thumbnail,
          latest_chapter: latestChapter,
          rating
        };
      });
    });
    
    return searchResults;
  } catch (error) {
    console.error('Error searching manga:', error);
    throw new Error(`Failed to search manga: ${error.message}`);
  } finally {
    await browser.close();
  }
}

/**
 * Get chapter data
 * @param {string} chapterUrl - URL of the chapter
 * @returns {Promise<ChapterData>} - Chapter data including images
 */
async function getChapterData(chapterUrl) {
  const browser = await launchBrowser();
  
  try {
    const page = await browser.newPage();
    
    // Set viewport size
    await page.setViewport({ width: 1280, height: 800 });
    
    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    // Navigate to chapter page
    await page.goto(chapterUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // Wait for pages to load
    await page.waitForSelector('.page-container', { timeout: 30000 });
    
    // Extract chapter data
    const chapterData = await page.evaluate(() => {
      const title = document.querySelector('.chapter-title')?.textContent?.trim() || 'Unknown Chapter';
      
      // Extract page images
      const imageElements = document.querySelectorAll('.page-image');
      const images = Array.from(imageElements).map((el, index) => {
        return {
          pageNumber: index + 1,
          imageUrl: el.getAttribute('src') || el.getAttribute('data-src') || null
        };
      });
      
      // Get navigation links
      const prevLink = document.querySelector('.prev-chapter')?.getAttribute('href');
      const nextLink = document.querySelector('.next-chapter')?.getAttribute('href');
      
      let prevChapter = null;
      if (prevLink) {
        const prevMatch = prevLink.match(/chapter\/(.*?)\/?$/);
        if (prevMatch) {
          prevChapter = prevMatch[1];
        }
      }
      
      let nextChapter = null;
      if (nextLink) {
        const nextMatch = nextLink.match(/chapter\/(.*?)\/?$/);
        if (nextMatch) {
          nextChapter = nextMatch[1];
        }
      }
      
      return {
        title,
        images,
        prev_chapter: prevChapter,
        next_chapter: nextChapter
      };
    });
    
    return chapterData;
  } catch (error) {
    console.error('Error getting chapter pages:', error);
    throw new Error(`Failed to get chapter pages: ${error.message}`);
  } finally {
    await browser.close();
  }
}

// Define API routes
app.get('/', (req, res) => {
  res.send('MangaDex Scraper API - Use /search/:query, /detail/:mangaId, or /read/:chapterId');
});

app.get('/search/:query', async (req, res) => {
  try {
    await delay(1500); // Add delay to avoid rate limiting
    const results = await searchManga(req.params.query);
    res.json({ results });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'An error occurred during the search.' });
  }
});

app.get('/read/:chapterId', async (req, res) => {
  try {
    await delay(1000); // Add delay to avoid rate limiting
    const decodedChapterId = decodeURIComponent(req.params.chapterId);
    const url = `https://mangadex.org/chapter/${decodedChapterId}`;
    const chapterData = await getChapterData(url);
    res.json(chapterData);
  } catch (error) {
    console.error('Reader error:', error);
    res.status(500).json({ 
      error: 'An error occurred while fetching the chapter.',
      images: [],
      prev_chapter: null,
      next_chapter: null
    });
  }
});

app.get('/detail/:mangaId', async (req, res) => {
  try {
    await delay(1000); // Add delay to avoid rate limiting
    const url = `https://mangadex.org/title/${req.params.mangaId}`;
    const mangaDetails = await scrapeMangaDetails(url);
    res.json(mangaDetails);
  } catch (error) {
    console.error('Manga detail error:', error);
    res.status(500).json({ error: 'An error occurred while fetching manga details.' });
  }
});

// Export the Express app for Vercel
module.exports = app;

// Start the server if not in a serverless environment
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
    }
