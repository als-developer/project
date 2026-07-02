// firebase.js - Firebase configuration and initialization
import { initializeApp } from "firebase/app";
import { 
  getDatabase, 
  ref, 
  set, 
  get, 
  push, 
  child, 
  update, 
  query, 
  orderByChild, 
  equalTo,
  remove,
  onValue
} from "firebase/database";
import { 
  getStorage, 
  ref as storageRef, 
  uploadBytes, 
  getDownloadURL, 
  deleteObject 
} from "firebase/storage";
import { getAnalytics, logEvent } from "firebase/analytics";
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

// Firebase configuration
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
  measurementId: process.env.FIREBASE_MEASUREMENT_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);
const storage = getStorage(app);
const analytics = getAnalytics(app);

// Firebase Database Service
class FirebaseService {
  // User Management
  static async createUser(username, password, email = '') {
    try {
      const usersRef = ref(database, 'users');
      const hashedPassword = await bcrypt.hash(password, 10);
      
      // Check if username exists
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
        files: {},
        totalFiles: 0,
        storageUsed: 0,
        lastLogin: null
      });

      logEvent(analytics, 'user_created', { username });

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

      // Update last login
      await update(ref(database, `users/${userId}`), {
        lastLogin: new Date().toISOString()
      });

      logEvent(analytics, 'user_login', { username });

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

  // File Upload
  static async uploadFile(userId, file, fileType) {
    try {
      // Generate unique filename
      const timestamp = Date.now();
      const uniqueId = Math.random().toString(36).substring(7);
      const fileName = `${userId}/${fileType}s/${timestamp}_${uniqueId}_${file.originalname}`;
      
      // Upload to Firebase Storage
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
      
      const uploadResult = await uploadBytes(storageRefPath, file.buffer, metadata);
      const downloadURL = await getDownloadURL(storageRefPath);

      // Save file metadata to Realtime Database
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
        uploadedAt: new Date().toISOString(),
        fileId: fileId,
        metadata: {
          width: file.width || null,
          height: file.height || null,
          duration: file.duration || null
        }
      };

      await set(newFileRef, fileData);

      // Update user's file count and storage usage
      const userRef = ref(database, `users/${userId}`);
      const userSnapshot = await get(userRef);
      const userData = userSnapshot.val();
      
      await update(userRef, {
        totalFiles: (userData.totalFiles || 0) + 1,
        storageUsed: (userData.storageUsed || 0) + file.size
      });

      // Log to Analytics
      logEvent(analytics, 'file_uploaded', {
        userId,
        fileType,
        fileSize: file.size,
        fileName: file.originalname
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

  // Get User Files
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

      // Sort by uploadedAt (newest first)
      files.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

      return { success: true, files };
    } catch (error) {
      console.error('Error getting user files:', error);
      return { success: false, error: error.message };
    }
  }

  // Get Files by Type
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

  // Delete File
  static async deleteFile(userId, fileId) {
    try {
      // Get file data
      const fileRef = ref(database, `users/${userId}/files/${fileId}`);
      const fileSnapshot = await get(fileRef);
      
      if (!fileSnapshot.exists()) {
        return { success: false, error: 'File not found' };
      }

      const fileData = fileSnapshot.val();

      // Delete from Storage
      if (fileData.storagePath) {
        const storageRefPath = storageRef(storage, fileData.storagePath);
        await deleteObject(storageRefPath);
      }

      // Delete from Database
      await remove(fileRef);

      // Update user's file count and storage usage
      const userRef = ref(database, `users/${userId}`);
      const userSnapshot = await get(userRef);
      const userData = userSnapshot.val();
      
      await update(userRef, {
        totalFiles: Math.max(0, (userData.totalFiles || 0) - 1),
        storageUsed: Math.max(0, (userData.storageUsed || 0) - (fileData.size || 0))
      });

      logEvent(analytics, 'file_deleted', {
        userId,
        fileId,
        fileType: fileData.type
      });

      return { success: true, message: 'File deleted successfully' };
    } catch (error) {
      console.error('Error deleting file:', error);
      return { success: false, error: error.message };
    }
  }

  // Get All Users (Admin)
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
        // Remove password from response
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

  // Get User Stats
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

  // Real-time file updates listener
  static listenToFiles(userId, callback) {
    const filesRef = ref(database, `users/${userId}/files`);
    return onValue(filesRef, (snapshot) => {
      if (snapshot.exists()) {
        const files = [];
        snapshot.forEach((childSnapshot) => {
          files.push({
            id: childSnapshot.key,
            ...childSnapshot.val()
          });
        });
        callback(files);
      } else {
        callback([]);
      }
    });
  }

  // Initialize demo admin user
  static async initDemoUser() {
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
  }
}

export { FirebaseService, database, storage, analytics };
