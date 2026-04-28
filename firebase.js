// firebase.js - Shared Firebase configuration and utilities
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, collection, addDoc, getDocs, query, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBEgkePSSuw1LkVOXLWL__pzcC11HGY_Ww",
  authDomain: "pagesync-7a722.firebaseapp.com",
  projectId: "pagesync-7a722",
  storageBucket: "pagesync-7a722.appspot.com",
  messagingSenderId: "612753494941",
  appId: "1:612753494941:web:192411b4fca39ddfdf9574"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

// Auth helpers
export async function signInWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  const user = result.user;

  // Check if user profile exists in Firestore
  const userDocRef = doc(db, 'users', user.uid);
  const userSnapshot = await getDoc(userDocRef);

  if (!userSnapshot.exists()) {
    const username = await createUniqueUsername(user.displayName || user.email);
    await setDoc(userDocRef, {
      displayName: user.displayName || '',
      email: user.email,
      username,
      provider: 'google',
      createdAt: serverTimestamp()
    });
  }

  return user;
}

export async function signupWithEmail(email, password, username) {
  if (await usernameExists(username)) {
    throw new Error('Username already taken');
  }

  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  const uid = userCredential.user.uid;

  await setDoc(doc(db, 'users', uid), {
    email,
    username,
    displayName: '',
    provider: 'local',
    createdAt: serverTimestamp()
  });

  return userCredential.user;
}

export async function loginWithEmail(email, password) {
  const userCredential = await signInWithEmailAndPassword(auth, email, password);
  return userCredential.user;
}

export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

export async function usernameExists(username) {
  const q = query(collection(db, 'users'), where('username', '==', username));
  const snapshot = await getDocs(q);
  return !snapshot.empty;
}

export async function createUniqueUsername(base) {
  let candidate = base.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  if (!candidate) candidate = 'reader';

  let suffix = 0;
  while (await usernameExists(suffix ? `${candidate}${suffix}` : candidate)) {
    suffix += 1;
  }

  return suffix ? `${candidate}${suffix}` : candidate;
}

// Book helpers
export async function addBook(uid, bookData) {
  const booksRef = collection(db, 'users', uid, 'books');
  await addDoc(booksRef, {
    ...bookData,
    addedAt: serverTimestamp()
  });
}

export async function getBooks(uid, status = null) {
  const booksRef = collection(db, 'users', uid, 'books');
  let q = query(booksRef);
  if (status) {
    q = query(booksRef, where('status', '==', status));
  }
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function updateBook(uid, bookId, updates) {
  const bookRef = doc(db, 'users', uid, 'books', bookId);
  await setDoc(bookRef, updates, { merge: true });
}

export async function deleteBook(uid, bookId) {
  const bookRef = doc(db, 'users', uid, 'books', bookId);
  await deleteDoc(bookRef);
}

// Auth state listener
export function onAuthStateChange(callback) {
  return onAuthStateChanged(auth, callback);
}
