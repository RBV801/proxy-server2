# Movie Search Proxy Server

This proxy server handles API requests for the movie search application.

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create `.env` file from `.env.example`:
   ```bash
   cp .env.example .env
   ```
4. Add your OMDB API key to `.env`
5. Start the server:
   ```bash
   npm start
   ```

For development:
```bash
npm run dev
```

## API Endpoints

- GET `/api/search?query=<search_term>` - Search for movies