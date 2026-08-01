// إعدادات Firebase + تهيئة db و auth (يعتمد على firebase compat SDK المحمّل عبر <script> في index.html)
const firebaseConfig = {
  apiKey: "AIzaSyBax5oKaW4Y3lT4DXBD88tXrUxZd2h6ujc",
  authDomain: "masarif-bayt-3909f.firebaseapp.com",
  projectId: "masarif-bayt-3909f",
  storageBucket: "masarif-bayt-3909f.firebasestorage.app",
  messagingSenderId: "422644628562",
  appId: "1:422644628562:web:779736ffaa9787f7b2338b"
};

firebase.initializeApp(firebaseConfig);
export const auth = firebase.auth();
export const db = firebase.firestore();

