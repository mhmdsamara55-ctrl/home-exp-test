// خدمة المصادقة: تسجيل الدخول بجوجل، تسجيل الخروج، ومراقبة حالة الدخول
// مستقلة تماماً (بدون اعتماد على app.js) لتسهيل أي نقل مستقبلي لـ React/Flutter
import { auth } from '../firebase/config.js';

// تسجيل الدخول ببيانات اعتماد Google Identity Services
// onError (اختياري): تُستدعى برسالة الخطأ النصية إذا فشل تسجيل الدخول
export function handleSignIn(response, onError) {
  auth.signInWithCredential(
    firebase.auth.GoogleAuthProvider.credential(response.credential)
  ).catch(err => {
    if (onError) onError(err.message);
  });
}

// تسجيل الخروج
export function logout() {
  auth.signOut();
}

// الاستماع لتغيّر حالة تسجيل الدخول (دخول/خروج) — يستقبل دالة callback(user|null)
export function onAuthChange(callback) {
  auth.onAuthStateChanged(callback);
}

