# Netflix Frontend Clone - Deployment Plan with R2 Storage

## 📋 Overview
This plan covers deploying your Netflix frontend clone with:
- **R2 (Cloudflare)** for media storage
- **Backend API** for content management
- **Easy content updates** (photos, text, videos, images)
- **Live deployment**

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│           Frontend (Vercel/Netlify)                 │
│  - React/Vue or Plain JS + fetch content dynamically│
└────────────────┬────────────────────────────────────┘
                 │ REST API calls
                 ▼
┌─────────────────────────────────────────────────────┐
│        Backend API (Node.js/Express)                │
│  - Routes for movies, shows, content management    │
│  - User authentication (optional)                  │
└────────────────┬────────────────────────────────────┘
                 │ Upload/retrieve files
                 ▼
┌─────────────────────────────────────────────────────┐
│      Cloudflare R2 (Object Storage)                 │
│  - Store all images, videos, posters               │
│  - Store metadata (JSON files)                     │
└─────────────────────────────────────────────────────┘
```

---

## 🚀 Phase 1: R2 Setup

### Step 1: Create Cloudflare Account & R2 Bucket
1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to **R2** → **Create bucket**
3. Name: `netflix-clone` (or similar)
4. Note your **Account ID** and **Bucket name**

### Step 2: Generate R2 API Credentials
1. Go to **Account Home** → **API Tokens**
2. Click **Create Token** → **Create Custom Token**
3. Permissions needed:
   - ✅ Account - R2 - All
4. Save:
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_API_TOKEN`
   - `R2_ACCESS_KEY_ID` (from API token details)
   - `R2_SECRET_ACCESS_KEY`

### Step 3: Set Up R2 URL & CORS
1. Get your **R2 domain**: `https://<bucket-name>.r2.dev/`
2. Enable public access or use signed URLs

---

## 📦 Phase 2: Backend API Setup

### Choose Your Backend Stack:
**Option A: Node.js + Express (Recommended)**
**Option B: Python + Flask**
**Option C: Use Cloudflare Workers (Serverless)**

### Backend Structure
```
backend/
├── config/
│   ├── r2.js           # R2 connection config
│   └── database.js     # Optional: Firebase/MongoDB
├── controllers/
│   ├── moviesController.js
│   ├── showsController.js
│   └── uploadController.js
├── routes/
│   ├── movies.js
│   ├── shows.js
│   └── upload.js
├── middleware/
│   ├── auth.js         # Optional authentication
│   └── upload.js       # File upload handling
├── models/
│   ├── Movie.js
│   └── Show.js
├── .env.example
├── server.js
└── package.json
```

### Key API Endpoints
```
POST   /api/content/movies       - Create new movie
GET    /api/content/movies       - Get all movies
PUT    /api/content/movies/:id   - Update movie
DELETE /api/content/movies/:id   - Delete movie
POST   /api/upload               - Upload image/video to R2
GET    /api/content/shows        - Get all TV shows
```

---

## 🗂️ Phase 3: Content Storage Structure in R2

### Bucket Directory Structure
```
netflix-clone/
├── movies/
│   ├── movie-1/
│   │   ├── poster.jpg
│   │   ├── thumbnail.jpg
│   │   ├── banner.jpg
│   │   └── video.mp4
│   ├── movie-2/
│   │   └── ...
├── shows/
│   ├── show-1/
│   │   ├── poster.jpg
│   │   ├── seasons/
│   │   │   ├── season-1/
│   │   │   │   └── episode-1.mp4
│   │   │   └── season-2/
│   │   └── ...
├── metadata/
│   ├── movies.json
│   ├── shows.json
│   └── trending.json
└── temp/
    └── uploads/
```

### Example Content Metadata (JSON)
```json
{
  "movies": [
    {
      "id": "movie-1",
      "title": "Movie Title",
      "description": "Description",
      "genre": ["Action", "Drama"],
      "rating": 8.5,
      "year": 2024,
      "poster": "https://netflix-clone.r2.dev/movies/movie-1/poster.jpg",
      "banner": "https://netflix-clone.r2.dev/movies/movie-1/banner.jpg",
      "video": "https://netflix-clone.r2.dev/movies/movie-1/video.mp4",
      "duration": 120
    }
  ]
}
```

---

## 💻 Phase 4: Frontend Modifications

### Convert Static HTML to Dynamic
Currently your HTML has hardcoded content. We need to:

1. **Keep** landing page static (index.html, login.html)
2. **Convert** browse, search, single pages to fetch from API

### Updated Frontend Structure
```
frontend/
├── public/
│   ├── index.html
│   ├── login.html
│   └── register.html
├── src/
│   ├── components/
│   │   ├── MovieCard.js
│   │   ├── ShowCard.js
│   │   └── VideoPlayer.js
│   ├── services/
│   │   └── api.js          # API calls
│   ├── pages/
│   │   ├── browse.js       # Fetch movies dynamically
│   │   ├── search.js
│   │   ├── single.js       # Individual movie/show page
│   │   └── mylist.js
│   └── main.js
```

### Example API Integration (JavaScript)
```javascript
// services/api.js
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

export const fetchMovies = async () => {
  const response = await fetch(`${API_URL}/api/content/movies`);
  return response.json();
};

export const fetchMovieById = async (id) => {
  const response = await fetch(`${API_URL}/api/content/movies/${id}`);
  return response.json();
};

export const uploadFile = async (file) => {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch(`${API_URL}/api/upload`, {
    method: 'POST',
    body: formData
  });
  return response.json();
};
```

---

## 🚢 Phase 5: Deployment Strategy

### Option 1: Vercel (Recommended for Frontend)
```bash
# Deploy frontend to Vercel
npm run build
vercel deploy --prod

# Set environment variables in Vercel dashboard:
REACT_APP_API_URL=https://your-backend.com
```

### Option 2: Backend Deployment Choices

**Option A: Railway, Render, or Heroku**
- Simple Git integration
- Free tier available
- `npm start` or `node server.js`

**Option B: Cloudflare Workers (Serverless)**
- No backend server to manage
- Direct integration with R2
- Pay-as-you-go

**Option C: AWS Lambda + API Gateway**
- Scalable
- Integrates with S3 or R2

### Option 3: Docker + Self-Hosted/VPS
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 5000
CMD ["node", "server.js"]
```

---

## 🎨 Phase 6: Admin Content Management Panel (Optional)

Create a simple admin dashboard to:
- ✅ Add/Edit/Delete movies
- ✅ Upload images and videos
- ✅ Manage collections/categories
- ✅ Preview changes

### Simple Admin Panel Tools
- **Option 1**: Build custom React admin dashboard
- **Option 2**: Use Strapi (headless CMS)
- **Option 3**: Use Firebase Console
- **Option 4**: Use Notion API + Custom Script

---

## 🔐 Phase 7: Security Considerations

1. **API Authentication**
   - Use JWT tokens for admin operations
   - Protect upload endpoints with authentication

2. **R2 Security**
   - Use restricted API tokens (R2-only permissions)
   - Store tokens in `.env` (never commit)
   - Enable IP whitelist if needed

3. **CORS Configuration**
   - Only allow requests from your domain
   - Restrict upload endpoints to authenticated users

4. **File Validation**
   - Validate file types (jpg, png, mp4, etc.)
   - Check file sizes before upload
   - Scan for malicious content

---

## 📊 Implementation Timeline

| Phase | Task | Duration | Tools |
|-------|------|----------|-------|
| 1 | R2 Setup | 15 mins | Cloudflare Dashboard |
| 2 | Backend API | 3-5 hours | Node.js + Express |
| 3 | R2 Integration | 2-3 hours | AWS SDK for JS |
| 4 | Frontend Refactor | 4-6 hours | JavaScript/React |
| 5 | Deployment Setup | 1-2 hours | Vercel + Railway |
| 6 | Testing | 2-3 hours | Postman + Browser |
| 7 | Admin Panel | 2-4 hours | React/Vue |

**Total: ~2-3 weeks** (depending on complexity)

---

## ✅ Quick Start Commands

```bash
# 1. Initialize backend
npm init -y
npm install express cors dotenv aws-sdk multer

# 2. Create .env
CLOUDFLARE_ACCOUNT_ID=your_id
R2_ACCESS_KEY_ID=your_key
R2_SECRET_ACCESS_KEY=your_secret
R2_BUCKET_NAME=netflix-clone
NODE_ENV=production

# 3. Start backend
node server.js

# 4. Deploy frontend
vercel deploy --prod
```

---

## 📚 Useful Resources

- [Cloudflare R2 Docs](https://developers.cloudflare.com/r2/)
- [AWS SDK for JavaScript](https://docs.aws.amazon.com/sdk-for-javascript/)
- [Express.js Guide](https://expressjs.com/)
- [Vercel Deployment](https://vercel.com/docs)
- [Railway Hosting](https://railway.app/)

---

## 🎯 Next Steps

1. **Create R2 bucket** ← Start here
2. **Build backend API** with express
3. **Test locally** with Postman
4. **Refactor frontend** to use dynamic data
5. **Deploy** to Vercel + Railway
6. **Create admin panel** for easy content updates

---

Would you like me to start implementing any of these phases?
