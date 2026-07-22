import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const app = getApps().length ? getApp() : initializeApp({
  apiKey: "AIzaSyDmg7pJm4krC_q2rXR5u7dvCZZ0NgkGSNI",
  authDomain: "hannna-purchase.firebaseapp.com",
  projectId: "hannna-purchase",
  storageBucket: "hannna-purchase.firebasestorage.app",
  messagingSenderId: "725448395935",
  appId: "1:725448395935:web:cb9ca137a36c84708c66aa",
});

export const auth = getAuth(app);
export const db = getFirestore(app);
