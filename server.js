// server.js - Complete single-file solution for Heroku
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcryptjs');

// Firebase imports (using require for CommonJS compatibility)
const { initializeApp } = require('firebase/app');
const { 
  getDatabase, 
  ref, 
  set, 
  get, 
  push, 
  update, 
  query, 
  orderByChild, 
  equalTo,
  remove
} = require('firebase/database');
const { 
  getStorage, 
  ref: storageRef, 
  uploadBytes, 
  getDownloadURL, 
  deleteObject 
} = require('firebase/storage');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== FIREBASE CONFIGURATION ====================
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || 'AIzaSyDhTmYl7RnhnjMvOui2azRySG69jnxS5mI',
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || 'city-22282.firebaseapp.com',
  databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://city-22282-default-rtdb.firebaseio.com',
  projectId: process.env.FIREBASE_PROJECT_ID || 'city-22282',
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'city-22282.firebasestorage.app',
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '576478647938',
  appId: process.env.FIREBASE_APP_ID || '1:576478647938:web:4caa4414d0687abe46869b'
};

// Initialize Firebase
let firebaseApp, database, storage;

try {
  firebaseApp = initializeApp(firebaseConfig);
  database = getDatabase(firebaseApp);
  storage = getStorage(firebaseApp);
  console.log('✅ Firebase initialized successfully');
} catch (error) {
  console.error('❌ Firebase initialization error:', error.message);
}

// ==================== MIDDLEWARE ====================
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

// ==================== MULTER CONFIGURATION ====================
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

// ==================== FIREBASE SERVICE CLASS ====================
class FirebaseService {
  static async createUser(username, password, email = '') {
    try {
      const usersRef = ref(database, 'users');
      const hashedPassword = await bcrypt.hash(password, 10);
      
      const userQuery = query(usersRef, orderByChild('username'), equalTo(username));
      const snapshot = await get(userQuery);
      
      if (snapshot.exists()) {
        return { success: false, error: 'Username already exists' };
      }

      const newUserRef = push(usersRef);
      const userId = newUserRef.key;
      
      await set(newUserRef, {
        id: userId,
        username: username,
        email: email || '',
        password: hashedPassword,
        createdAt: new Date().toISOString(),
        totalFiles: 0,
        storageUsed: 0,
        lastLogin: null
      });

      return { 
        success: true, 
        userId: userId,
        message: 'User created successfully'
      };
    } catch (error) {
      console.error('Error creating user:', error);
      return { success: false, error: error.message };
    }
  }

  static async loginUser(username, password) {
    try {
      const usersRef = ref(database, 'users');
      const userQuery = query(usersRef, orderByChild('username'), equalTo(username));
      const snapshot = await get(userQuery);
      
      if (!snapshot.exists()) {
        return { success: false, error: 'User not found' };
      }

      let userData = null;
      let userId = null;
      
      snapshot.forEach((childSnapshot) => {
        userData = childSnapshot.val();
        userId = childSnapshot.key;
      });

      const isPasswordValid = await bcrypt.compare(password, userData.password);
      
      if (!isPasswordValid) {
        return { success: false, error: 'Invalid password' };
      }

      await update(ref(database, `users/${userId}`), {
        lastLogin: new Date().toISOString()
      });

      return { 
        success: true, 
        userId: userId,
        user: {
          id: userId,
          username: userData.username,
          email: userData.email,
          createdAt: userData.createdAt,
          totalFiles: userData.totalFiles || 0,
          storageUsed: userData.storageUsed || 0
        }
      };
    } catch (error) {
      console.error('Error logging in:', error);
      return { success: false, error: error.message };
    }
  }

  static async uploadFile(userId, file, fileType) {
    try {
      const timestamp = Date.now();
      const uniqueId = Math.random().toString(36).substring(7);
      const fileName = `${userId}/${fileType}s/${timestamp}_${uniqueId}_${file.originalname}`;
      
      const storageRefPath = storageRef(storage, fileName);
      const metadata = {
        contentType: file.mimetype,
        customMetadata: {
          userId: userId,
          fileType: fileType,
          originalName: file.originalname,
          uploadedAt: new Date().toISOString()
        }
      };
      
      await uploadBytes(storageRefPath, file.buffer, metadata);
      const downloadURL = await getDownloadURL(storageRefPath);

      const userFilesRef = ref(database, `users/${userId}/files`);
      const newFileRef = push(userFilesRef);
      const fileId = newFileRef.key;

      const fileData = {
        id: fileId,
        name: file.originalname,
        type: fileType,
        mimeType: file.mimetype,
        size: file.size,
        storagePath: fileName,
        downloadURL: downloadURL,
        uploadedAt: new Date().toISOString()
      };

      await set(newFileRef, fileData);

      const userRef = ref(database, `users/${userId}`);
      const userSnapshot = await get(userRef);
      const userData = userSnapshot.val();
      
      await update(userRef, {
        totalFiles: (userData.totalFiles || 0) + 1,
        storageUsed: (userData.storageUsed || 0) + file.size
      });

      return {
        success: true,
        fileId: fileId,
        downloadURL: downloadURL,
        fileData: fileData
      };
    } catch (error) {
      console.error('Error uploading file:', error);
      return { success: false, error: error.message };
    }
  }

  static async getUserFiles(userId) {
    try {
      const userFilesRef = ref(database, `users/${userId}/files`);
      const snapshot = await get(userFilesRef);
      
      if (!snapshot.exists()) {
        return { success: true, files: [] };
      }

      const files = [];
      snapshot.forEach((childSnapshot) => {
        files.push({
          id: childSnapshot.key,
          ...childSnapshot.val()
        });
      });

      files.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
      return { success: true, files };
    } catch (error) {
      console.error('Error getting user files:', error);
      return { success: false, error: error.message };
    }
  }

  static async getFilesByType(userId, fileType) {
    try {
      const userFilesRef = ref(database, `users/${userId}/files`);
      const snapshot = await get(userFilesRef);
      
      if (!snapshot.exists()) {
        return { success: true, files: [] };
      }

      const files = [];
      snapshot.forEach((childSnapshot) => {
        const file = childSnapshot.val();
        if (file.type === fileType) {
          files.push({
            id: childSnapshot.key,
            ...file
          });
        }
      });

      files.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
      return { success: true, files };
    } catch (error) {
      console.error('Error getting files by type:', error);
      return { success: false, error: error.message };
    }
  }

  static async deleteFile(userId, fileId) {
    try {
      const fileRef = ref(database, `users/${userId}/files/${fileId}`);
      const fileSnapshot = await get(fileRef);
      
      if (!fileSnapshot.exists()) {
        return { success: false, error: 'File not found' };
      }

      const fileData = fileSnapshot.val();

      if (fileData.storagePath) {
        const storageRefPath = storageRef(storage, fileData.storagePath);
        await deleteObject(storageRefPath);
      }

      await remove(fileRef);

      const userRef = ref(database, `users/${userId}`);
      const userSnapshot = await get(userRef);
      const userData = userSnapshot.val();
      
      await update(userRef, {
        totalFiles: Math.max(0, (userData.totalFiles || 0) - 1),
        storageUsed: Math.max(0, (userData.storageUsed || 0) - (fileData.size || 0))
      });

      return { success: true, message: 'File deleted successfully' };
    } catch (error) {
      console.error('Error deleting file:', error);
      return { success: false, error: error.message };
    }
  }

  static async getUserStats(userId) {
    try {
      const userRef = ref(database, `users/${userId}`);
      const snapshot = await get(userRef);
      
      if (!snapshot.exists()) {
        return { success: false, error: 'User not found' };
      }

      const userData = snapshot.val();
      return {
        success: true,
        stats: {
          totalFiles: userData.totalFiles || 0,
          storageUsed: userData.storageUsed || 0,
          createdAt: userData.createdAt,
          lastLogin: userData.lastLogin
        }
      };
    } catch (error) {
      console.error('Error getting user stats:', error);
      return { success: false, error: error.message };
    }
  }

  static async getAllUsers() {
    try {
      const usersRef = ref(database, 'users');
      const snapshot = await get(usersRef);
      
      if (!snapshot.exists()) {
        return { success: true, users: [] };
      }

      const users = [];
      snapshot.forEach((childSnapshot) => {
        const userData = childSnapshot.val();
        delete userData.password;
        users.push({
          id: childSnapshot.key,
          ...userData
        });
      });

      return { success: true, users };
    } catch (error) {
      console.error('Error getting users:', error);
      return { success: false, error: error.message };
    }
  }

  static async initDemoUser() {
    try {
      const adminUsername = 'demo';
      const adminPassword = 'demo123';
      
      const usersRef = ref(database, 'users');
      const userQuery = query(usersRef, orderByChild('username'), equalTo(adminUsername));
      const snapshot = await get(userQuery);
      
      if (!snapshot.exists()) {
        await this.createUser(adminUsername, adminPassword, 'demo@example.com');
        console.log('✅ Demo user created: demo / demo123');
      } else {
        console.log('✅ Demo user already exists');
      }
    } catch (error) {
      console.error('Error creating demo user:', error);
    }
  }
}

// ==================== API ROUTES ====================

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Test route
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'Server is running!', 
    timestamp: new Date().toISOString()
  });
});

// Check session
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

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, email } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
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

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const result = await FirebaseService.loginUser(username, password);
    
    if (result.success) {
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

// Logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to logout' });
    }
    res.json({ success: true, message: 'Logged out successfully' });
  });
});

// Upload file
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'Please login first' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const mimeType = req.file.mimetype;
    let fileType = 'other';
    
    if (mimeType.startsWith('image/')) {
      fileType = 'image';
    } else if (mimeType.startsWith('video/')) {
      fileType = 'video';
    }

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

// Get all files
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
      return res.status(400).json({ error: 'Invalid file type' });
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

// Get stats
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

// Admin - get all users
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

// Serve HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    error: err.message || 'Internal server error'
  });
});

// ==================== START SERVER ====================
async function startServer() {
  try {
    // Initialize demo user
    await FirebaseService.initDemoUser();
    
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📱 Open: http://localhost:${PORT}`);
      console.log(`🔑 Demo: demo / demo123`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

module.exports = app;
