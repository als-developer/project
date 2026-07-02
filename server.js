// server.js - Main Express Server (CommonJS version for Heroku compatibility)
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');
const session = require('express-session');
const path = require('path');
const { FirebaseService } = require('./firebase.cjs');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? 'https://project-test-bdeffc30af24.herokuapp.com' 
    : 'http://localhost:3000',
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Configure multer for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const allowedVideoTypes = ['video/mp4', 'video/webm', 'video/ogg', 'video/avi'];
    
    if (allowedImageTypes.includes(file.mimetype) || allowedVideoTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images and videos are allowed.'));
    }
  }
});

// Initialize demo user (async IIFE)
(async function initDemoUser() {
  try {
    await FirebaseService.initDemoUser();
    console.log('✅ Firebase initialized successfully');
  } catch (error) {
    console.error('❌ Firebase initialization error:', error.message);
  }
})();

// ==================== API ROUTES ====================

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    memory: process.memoryUsage()
  });
});

// Test route
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'Server is running!', 
    timestamp: new Date().toISOString(),
    session: req.session.id
  });
});

// Check session status
app.get('/api/session', (req, res) => {
  if (req.session.userId) {
    res.json({ 
      authenticated: true, 
      userId: req.session.userId,
      username: req.session.username 
    });
  } else {
    res.json({ authenticated: false });
  }
});

// Register user
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, email } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    const result = await FirebaseService.createUser(username, password, email);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login user
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const result = await FirebaseService.loginUser(username, password);
    
    if (result.success) {
      // Set session
      req.session.userId = result.userId;
      req.session.username = result.user.username;
      
      res.json({
        success: true,
        user: result.user,
        sessionId: req.session.id
      });
    } else {
      res.status(401).json(result);
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout user
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to logout' });
    }
    res.json({ success: true, message: 'Logged out successfully' });
  });
});

// Upload file (authentication required)
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    // Check authentication
    if (!req.session.userId) {
      return res.status(401).json({ error: 'Please login first' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Determine file type
    const mimeType = req.file.mimetype;
    let fileType = 'other';
    
    if (mimeType.startsWith('image/')) {
      fileType = 'image';
    } else if (mimeType.startsWith('video/')) {
      fileType = 'video';
    }

    // Upload to Firebase
    const result = await FirebaseService.uploadFile(
      req.session.userId,
      req.file,
      fileType
    );

    if (result.success) {
      res.json({
        success: true,
        file: result.fileData,
        downloadURL: result.downloadURL
      });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message || 'Upload failed' });
  }
});

// Get user's files
app.get('/api/files', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'Please login first' });
    }

    const result = await FirebaseService.getUserFiles(req.session.userId);
    
    if (result.success) {
      res.json({
        success: true,
        files: result.files
      });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    console.error('Get files error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get files by type
app.get('/api/files/:type', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'Please login first' });
    }

    const { type } = req.params;
    if (!['image', 'video'].includes(type)) {
      return res.status(400).json({ error: 'Invalid file type. Use "image" or "video"' });
    }

    const result = await FirebaseService.getFilesByType(req.session.userId, type);
    
    if (result.success) {
      res.json({
        success: true,
        files: result.files
      });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    console.error('Get files by type error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete file
app.delete('/api/files/:fileId', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'Please login first' });
    }

    const { fileId } = req.params;
    const result = await FirebaseService.deleteFile(req.session.userId, fileId);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(404).json(result);
    }
  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get user stats
app.get('/api/stats', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'Please login first' });
    }

    const result = await FirebaseService.getUserStats(req.session.userId);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Admin route - get all users
app.get('/api/admin/users', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'Please login first' });
    }

    const result = await FirebaseService.getAllUsers();
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Serve main HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    error: err.message || 'Internal server error',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Open browser and navigate to http://localhost:${PORT}`);
  console.log(`🔑 Demo credentials: demo / demo123`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
