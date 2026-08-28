import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const hasFirebaseConfig = Object.values(firebaseConfig).every(Boolean);

const app = hasFirebaseConfig ? initializeApp(firebaseConfig) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;
const provider = app ? new GoogleAuthProvider() : null;

function userDoc(uid) {
  return doc(db, "users", uid);
}

function transactionCollection(uid) {
  return collection(db, "users", uid, "transactions");
}

function shortcutCollection(uid) {
  return collection(db, "users", uid, "shortcuts");
}

function normalizeDoc(snapshot) {
  return {
    id: snapshot.id,
    ...snapshot.data(),
  };
}

export {
  addDoc,
  auth,
  collection,
  db,
  deleteDoc,
  doc,
  getDocs,
  hasFirebaseConfig,
  onAuthStateChanged,
  onSnapshot,
  provider,
  query,
  serverTimestamp,
  setDoc,
  shortcutCollection,
  signInWithPopup,
  signOut,
  transactionCollection,
  updateDoc,
  userDoc,
  writeBatch,
  normalizeDoc,
};
