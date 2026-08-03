// خدمة العائلة: عمليات Firestore الخاصة بإنشاء/الانضمام/الأعضاء/طلبات الانضمام
// دوال بيانات فقط (بدون DOM أو حالة تطبيق) — لتسهيل أي نقل مستقبلي لـ React/Flutter
import { db } from '../firebase/config.js';
import { MAX_FAMILY_MEMBERS } from '../shared/constants.js';

export function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// يتحقق هل عند المستخدم عيلة مسجلة، ويرجّع بيانات العيلة أو null
export async function fetchUserFamily(uid) {
  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists || !userDoc.data().familyCode) return null;

  const code = userDoc.data().familyCode;
  const famDoc = await db.collection('families').doc(code).get();
  if (!famDoc.exists) return null;

  const famData = famDoc.data();
  let memberUids = famData.memberUids;
  if (!memberUids) {
    memberUids = (famData.members || []).map(m => m.uid);
    await db.collection('families').doc(code).update({ memberUids });
  }
  return { code, name: famData.name, members: famData.members || [], memberUids, createdBy: famData.createdBy };
}

// ينشئ عيلة جديدة ويربطها بالمستخدم الحالي
export async function createFamilyDoc(user, name) {
  const code = generateCode();
  const members = [{ uid: user.uid, name: user.displayName, email: user.email }];
  const memberUids = [user.uid];
  await db.collection('families').doc(code).set({
    name, createdBy: user.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    members, memberUids, plan: 'free'
  });
  await db.collection('users').doc(user.uid).set({ familyCode: code, name: user.displayName, email: user.email });
  return { code, name, members, memberUids, createdBy: user.uid };
}

// يعالج طلب الانضمام بكود دعوة
// يرجّع: { status: 'entered', family } أو { status: 'pending' } أو { status: 'full' } أو { status: 'invalid' }
export async function joinFamilyByCode(user, code) {
  const famDoc = await db.collection('families').doc(code).get();
  if (!famDoc.exists) return { status: 'invalid' };

  const famData = famDoc.data();
  const members = famData.members || [];
  const memberUids = famData.memberUids || members.map(m => m.uid);
  const already = members.some(m => m.uid === user.uid);

  if (already) {
    await db.collection('users').doc(user.uid).set({ familyCode: code, name: user.displayName, email: user.email });
    return { status: 'entered', family: { code, name: famData.name, members, memberUids, createdBy: famData.createdBy } };
  }

  if (members.length >= MAX_FAMILY_MEMBERS) {
    return { status: 'full' };
  }

  await db.collection('families').doc(code).collection('joinRequests').doc(user.uid).set({
    uid: user.uid, name: user.displayName, email: user.email,
    requestedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  return { status: 'pending' };
}

// يرجّع قائمة أعضاء العيلة الحاليين
export async function fetchFamilyMembers(code) {
  const famDoc = await db.collection('families').doc(code).get();
  return famDoc.data().members || [];
}

// يرجّع طلبات الانضمام المعلّقة
export async function fetchJoinRequests(code) {
  const reqSnap = await db.collection('families').doc(code).collection('joinRequests').get();
  return reqSnap.docs.map(doc => doc.data());
}

// يقبل طلب انضمام: يحدّث قائمة الأعضاء ويحذف الطلب، يرجّع القائمة المحدثة
export async function approveJoinRequestDoc(code, uid, name, email, currentMembers, currentMemberUids) {
  const members = [...(currentMembers || []), { uid, name, email }];
  const memberUids = [...(currentMemberUids || []), uid];
  await db.collection('families').doc(code).update({ members, memberUids });
  await db.collection('families').doc(code).collection('joinRequests').doc(uid).delete();
  return { members, memberUids };
}

// يرفض طلب انضمام
export async function rejectJoinRequestDoc(code, uid) {
  await db.collection('families').doc(code).collection('joinRequests').doc(uid).delete();
}

