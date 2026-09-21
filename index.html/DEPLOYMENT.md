# 🚀 Deployment Guide - Sea Chef Labs

## Overview

This guide covers multiple ways to deploy and access your Sea Chef Labs application.

---

## 📦 Option 1: Run Locally (Recommended for Testing)

### Prerequisites:
- Node.js v18+ (https://nodejs.org)
- Git (optional)

### Steps:

#### 1. Extract/Clone the Project
```powershell
# If you have a ZIP file
cd C:\Users\craig\Downloads
# Extract sea-chef-labs.zip

# Or with Git
git clone <repository-url>
cd sea-chef-labs
```

#### 2. Install Dependencies
```powershell
npm install
```

#### 3. Start Development Server
```powershell
npm run dev
```

#### 4. Access the App
Open browser and go to: `http://localhost:5173`

---

## 🌐 Option 2: Deploy to Vercel (Free, Easiest)

### What is Vercel?
Free hosting platform, perfect for React apps. Your app gets a public URL.

### Steps:

#### 1. Create Vercel Account
Go to: https://vercel.com
Sign up with GitHub, GitLab, or Email

#### 2. Install Vercel CLI
```powershell
npm install -g vercel
```

#### 3. Deploy
```powershell
cd sea-chef-labs
vercel
```

Follow the prompts:
- Set up and deploy? **Y**
- Which scope? (your account)
- Link to existing project? **N**
- Project name? **sea-chef-labs**
- Directory? **./** (press Enter)
- Override settings? **N**

#### 4. Access Your App
Vercel will give you a URL like:
```
https://sea-chef-labs.vercel.app
```

#### 5. Access from Any Device
- iPhone: Open Safari → go to URL
- iPad: Same
- Android: Same
- Any browser: Same

---

## 🌐 Option 3: Deploy to Netlify (Free, Alternative)

### Steps:

#### 1. Build the Project
```powershell
npm run build
```
This creates a `dist/` folder.

#### 2. Drag and Drop
1. Go to: https://app.netlify.com/drop
2. Drag the `dist/` folder onto the page
3. Wait for upload (30 seconds)
4. Get your URL: `https://random-name.netlify.app`

#### 3. Customize URL (Optional)
- Go to Site Settings → Domain Management
- Change site name to: `sea-chef-labs`
- New URL: `https://sea-chef-labs.netlify.app`

---

## 🌐 Option 4: Deploy to GitHub Pages (Free)

### Prerequisites:
- GitHub account
- Git installed

### Steps:

#### 1. Create GitHub Repository
```powershell
cd sea-chef-labs
git init
git add .
git commit -m "Initial commit"
```

#### 2. Push to GitHub
```powershell
# Create repo on github.com first, then:
git remote add origin https://github.com/YOUR_USERNAME/sea-chef-labs.git
git branch -M main
git push -u origin main
```

#### 3. Deploy
```powershell
npm run deploy
```
(Requires `gh-pages` package: `npm install -D gh-pages`)

#### 4. Access
URL: `https://YOUR_USERNAME.github.io/sea-chef-labs/`

---

## 📱 Access from iPhone/iPad

### Method 1: Direct URL Access
1. Open Safari on iPhone
2. Go to your deployed URL (e.g., `https://sea-chef-labs.vercel.app`)
3. The app works in mobile Safari!

### Method 2: Add to Home Screen (PWA-style)
1. Open app in Safari
2. Tap Share button (square with arrow ↑)
3. Scroll down, tap "Add to Home Screen"
4. Tap "Add"
5. Now you have an app icon!

### Method 3: Access Local Server (Advanced)
If running on your computer:
1. Find your computer's IP:
   ```powershell
   ipconfig
   # Look for IPv4 Address (e.g., 192.168.1.100)
   ```
2. On iPhone (same WiFi), go to:
   ```
   http://192.168.1.100:5173
   ```

---

## 📌 Pin to Microsoft Edge

### Method 1: Pin Tab
1. Open app in Edge
2. Right-click the tab
3. Select "Pin tab"
4. Tab stays open on the left

### Method 2: Install as App
1. Open app in Edge
2. Click ⋯ (three dots)
3. Apps → Install this site as an app
4. Click Install
5. Now it's in your Start menu!

### Method 3: Create Desktop Shortcut
1. Open app in Edge
2. Click ⋯
3. More tools → Create shortcut
4. Check "Open as window"
5. Click Create
6. Shortcut on desktop!

---

## 🔧 Build for Production

### Create Optimized Build
```powershell
npm run build
```

This creates:
```
dist/
├── index.html
├── assets/
│   ├── index-[hash].js
│   └── index-[hash].css
└── ...
```

### What's in the Build?
- Minified JavaScript (smaller file size)
- Optimized CSS
- Compressed assets
- Ready for deployment

### Test Production Build Locally
```powershell
npm run preview
```
Opens: `http://localhost:4173`

---

## 🌍 Custom Domain (Optional)

### If You Have a Domain:

#### 1. Vercel
- Go to Project Settings → Domains
- Add your domain: `yourdomain.com`
- Update DNS records as instructed

#### 2. Netlify
- Go to Site Settings → Domain Management
- Add custom domain
- Follow DNS instructions

#### 3. GitHub Pages
- Create `CNAME` file in root with your domain
- Update DNS to point to GitHub Pages

---

## 📊 Deployment Comparison

| Platform | Cost | Difficulty | Features |
|----------|------|------------|----------|
| **Local** | Free | Easy | Testing only |
| **Vercel** | Free | Easy | Auto-deploy, analytics |
| **Netlify** | Free | Easy | Drag & drop, forms |
| **GitHub Pages** | Free | Medium | Version control |
| **AWS/Azure** | $ | Hard | Enterprise features |

---

## 🔄 Auto-Deploy on Git Push

### Vercel Auto-Deploy:
1. Connect GitHub repo to Vercel
2. Every `git push` auto-deploys
3. Preview URLs for branches

### Netlify Auto-Deploy:
1. Connect GitHub repo
2. Every push triggers build
3. Deploy previews for PRs

---

## 🛡️ Security for Deployment

### HTTPS (Automatic)
- Vercel: ✅ Automatic SSL
- Netlify: ✅ Automatic SSL
- GitHub Pages: ✅ Automatic SSL

### Environment Variables
For production, you'd need:
```bash
# .env file (never commit this!)
VITE_API_KEY=your_api_key
VITE_WALLET_CONNECT_ID=your_id
```

### CORS Configuration
If connecting to APIs, configure CORS on backend.

---

## 📱 Mobile Optimization

### The app is already mobile-responsive!

Features:
- ✅ Touch-friendly buttons
- ✅ Responsive layout
- ✅ Works on all screen sizes
- ✅ Optimized for mobile browsers

### Test on Mobile:
1. Deploy to Vercel/Netlify
2. Open URL on phone
3. Test all features
4. Add to home screen

---

## 🐛 Troubleshooting

### "npm: command not found"
**Solution:** Install Node.js from https://nodejs.org

### "Port 5173 already in use"
**Solution:** 
```powershell
# Kill the process
netstat -ano | findstr :5173
taskkill /PID <PID> /F
```

### "Build failed"
**Solution:**
```powershell
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install
npm run build
```

### "Can't access from phone"
**Solution:**
- Make sure phone and computer are on same WiFi
- Check firewall settings
- Use computer's IP address (not localhost)

---

## 📈 Performance Optimization

### Already Optimized:
- ✅ Code splitting
- ✅ Tree shaking
- ✅ Minification
- ✅ Asset optimization

### Further Optimization (Optional):
```javascript
// vite.config.ts
export default {
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          ethers: ['ethers'],
        }
      }
    }
  }
}
```

---

## 🎯 Recommended Deployment Path

### For Testing/Exploration:
1. ✅ Run locally (`npm run dev`)
2. ✅ Test on computer
3. ✅ Test on phone (same WiFi)

### For Sharing/Demo:
1. ✅ Deploy to Vercel (free, easy)
2. ✅ Share URL with friends
3. ✅ Add to home screen on phone

### For Production (Future):
1. ✅ Hire developers
2. ✅ Add backend
3. ✅ Implement security
4. ✅ Deploy to cloud (AWS/Azure)
5. ✅ Custom domain
6. ✅ Monitoring & analytics

---

## 📞 Support

### Vercel Support:
- Docs: https://vercel.com/docs
- Community: https://github.com/vercel/vercel/discussions

### Netlify Support:
- Docs: https://docs.netlify.com
- Community: https://answers.netlify.com

### General:
- React: https://react.dev
- Vite: https://vitejs.dev

---

## 🎉 Quick Start Summary

### Fastest Way to See It:
```powershell
# 1. Install Node.js (if not installed)
# 2. Open PowerShell in project folder
# 3. Run:
npm install
npm run dev
# 4. Open http://localhost:5173
```

### Fastest Way to Deploy:
```powershell
# 1. Deploy to Vercel:
npm install -g vercel
vercel
# 2. Get URL and share!
```

### Fastest Way on iPhone:
1. Deploy to Vercel
2. Open URL in Safari
3. Add to Home Screen
4. Done!

---

**🚀 Happy Deploying!**

*Your app is ready to run anywhere!*
