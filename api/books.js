// api/books.js - Vercel serverless function for book operations
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      type: "service_account",
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      client_id: process.env.FIREBASE_CLIENT_ID,
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      token_uri: "https://oauth2.googleapis.com/token",
      auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
      client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL
    }),
    databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}.firebaseio.com`
  });
}

const db = getFirestore();

export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const idToken = authHeader.split('Bearer ')[1];
  let decodedToken;

  try {
    decodedToken = await getAuth().verifyIdToken(idToken);
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const uid = decodedToken.uid;

  if (req.method === 'GET') {
    // Get user's books
    const status = req.query.status;
    const booksRef = db.collection('users').doc(uid).collection('books');
    let query = booksRef;
    if (status) {
      query = query.where('status', '==', status);
    }

    const snapshot = await query.get();
    const books = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return res.json(books);

  } else if (req.method === 'POST') {
    // Add a book
    const { title, author, status, genre, notes } = req.body;
    if (!title || !author) {
      return res.status(400).json({ error: 'Title and author are required' });
    }

    const bookRef = await db.collection('users').doc(uid).collection('books').add({
      title,
      author,
      status: status || 'planned',
      genre: genre || '',
      notes: notes || '',
      addedAt: new Date()
    });

    return res.status(201).json({ id: bookRef.id });

  } else if (req.method === 'PUT') {
    // Update a book
    const { id, ...updates } = req.body;
    if (!id) {
      return res.status(400).json({ error: 'Book ID is required' });
    }

    await db.collection('users').doc(uid).collection('books').doc(id).update(updates);
    return res.json({ message: 'Book updated' });

  } else if (req.method === 'DELETE') {
    // Delete a book
    const { id } = req.query;
    if (!id) {
      return res.status(400).json({ error: 'Book ID is required' });
    }

    await db.collection('users').doc(uid).collection('books').doc(id).delete();
    return res.json({ message: 'Book deleted' });

  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}