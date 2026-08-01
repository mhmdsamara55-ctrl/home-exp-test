import { db, auth } from './firebase/config.js';
import { GOOGLE_CLIENT_ID, MAX_FAMILY_MEMBERS, EXPENSE_CATEGORIES, PAGE_TITLES } from './shared/constants.js';

let currentUser = null;
let currentFamily = null;
let allTransactions = [];
let categoryChartInstance = null;
let incomeExpenseChartInstance = null;
let selectedExpCategory = 'غذاء';
let selectedIncomeSource = 'راتب';
let budgetLimits = {};
let exchangeRates = { USD: 3.6, JOD: 5.08, SAR: 0.96 };
let debts = [];
function isMobile() { return window.innerWidth <= 768; }
function toBase(amount, currency) { return currency === 'ILS' ? amount : amount * (exchangeRates[currency] || 1); }

function selectExpCategory(value, el) {
  selectedExpCategory = value;
  document.querySelectorAll('#expCategoryGrid .category-tile').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
}
function selectIncomeSource(value, el) {
  selectedIncomeSource = value;
  document.querySelectorAll('#incSourceGrid .category-tile').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
}

window.onload = function() {
  google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleSignIn });
  google.accounts.id.renderButton(document.getElementById('google_signin_button'),
    { theme:'filled_blue', size:'large', width:'100%' });

  auth.onAuthStateChanged(async user => {
    if (user) {
      currentUser = user;
      await checkUserFamily();
    } else {
      currentUser = null;
      currentFamily = null;
      showOnly('login');
    }
  });
};

function handleSignIn(response) {
  firebase.auth().signInWithCredential(
    firebase.auth.GoogleAuthProvider.credential(response.credential)
  ).catch(err => showAlert('errorAlert', 'خطأ: ' + err.message));
}

function logout() { auth.signOut(); }

function showOnly(which) {
  document.getElementById('loginScreen').style.display = which === 'login' ? 'flex' : 'none';
  document.getElementById('familyScreen').classList.toggle('show', which === 'family');
  document.getElementById('appLayout').classList.toggle('show', which === 'app');
}

function showFamilyScreen() { currentFamily = null; showOnly('family'); }

function showCreateForm() {
  document.getElementById('createForm').style.display = 'block';
  document.getElementById('joinForm').style.display = 'none';
}
function showJoinForm() {
  document.getElementById('joinForm').style.display = 'block';
  document.getElementById('createForm').style.display = 'none';
}

async function checkUserFamily() {
  try {
    const userDoc = await db.collection('users').doc(currentUser.uid).get();
    if (userDoc.exists && userDoc.data().familyCode) {
      const code = userDoc.data().familyCode;
      const famDoc = await db.collection('families').doc(code).get();
      if (famDoc.exists) {
        const famData = famDoc.data();
        let memberUids = famData.memberUids;
        if (!memberUids) {
          memberUids = (famData.members || []).map(m => m.uid);
          await db.collection('families').doc(code).update({ memberUids });
        }
        currentFamily = { code, name: famData.name, members: famData.members || [], memberUids, createdBy: famData.createdBy };
        enterApp();
        return;
      }
    }
    showOnly('family');
  } catch (e) { showOnly('family'); }
}

function generateCode() { return Math.random().toString(36).substring(2, 8).toUpperCase(); }

async function createFamily() {
  const name = document.getElementById('newFamilyName').value.trim();
  if (!name) { showAlert('famErrorAlert', 'أدخل اسم العيلة'); return; }

  try {
    const code = generateCode();
    const members = [{ uid: currentUser.uid, name: currentUser.displayName, email: currentUser.email }];
    const memberUids = [currentUser.uid];
    await db.collection('families').doc(code).set({
      name, createdBy: currentUser.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      members, memberUids, plan: 'free'
    });
    await db.collection('users').doc(currentUser.uid).set({ familyCode: code, name: currentUser.displayName, email: currentUser.email });
    currentFamily = { code, name, members, memberUids, createdBy: currentUser.uid };
    enterApp();
  } catch (e) { showAlert('famErrorAlert', 'خطأ: ' + e.message); }
}

async function joinFamily() {
  const code = document.getElementById('joinCode').value.trim().toUpperCase();
  if (!code) { showAlert('famErrorAlert', 'أدخل كود الدعوة'); return; }

  try {
    const famDoc = await db.collection('families').doc(code).get();
    if (!famDoc.exists) { showAlert('famErrorAlert', 'كود الدعوة غير صحيح'); return; }

    const famData = famDoc.data();
    const members = famData.members || [];
    const memberUids = famData.memberUids || members.map(m => m.uid);
    const already = members.some(m => m.uid === currentUser.uid);

    if (already) {
      // منضم فعلاً (تمت الموافقة عليه سابقاً) — يدخل مباشرة
      await db.collection('users').doc(currentUser.uid).set({ familyCode: code, name: currentUser.displayName, email: currentUser.email });
      currentFamily = { code, name: famData.name, members, memberUids, createdBy: famData.createdBy };
      enterApp();
      return;
    }

    if (members.length >= MAX_FAMILY_MEMBERS) {
      showAlert('famErrorAlert', `هذه العيلة وصلت الحد الأقصى (${MAX_FAMILY_MEMBERS} أشخاص). الخطط المدفوعة قريباً 🚀`);
      return;
    }

    // بدل الانضمام المباشر: إرسال طلب انضمام ينتظر موافقة مسؤول العيلة
    await db.collection('families').doc(code).collection('joinRequests').doc(currentUser.uid).set({
      uid: currentUser.uid, name: currentUser.displayName, email: currentUser.email,
      requestedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showAlert('famSuccessAlert', '✅ تم إرسال طلب انضمامك، بانتظار موافقة مسؤول العيلة. جرب تدخل بنفس الكود بعد ما توافق.');
  } catch (e) { showAlert('famErrorAlert', 'خطأ: ' + e.message); }
}

function enterApp() {
  document.getElementById('familyNameLabel').textContent = 'عيلة: ' + currentFamily.name;
  document.getElementById('inviteCodeDisplay').textContent = currentFamily.code;
  document.getElementById('inviteCodeDisplay2').textContent = currentFamily.code;
  document.getElementById('menuFamName').textContent = currentFamily.name;
  showOnly('app');
  loadExchangeRates();
  switchPage(isMobile() ? 'menu' : 'dashboard');
  loadAllData();
}

function goToMenu() { switchPage('menu'); }

function copyCode() {
  navigator.clipboard.writeText(currentFamily.code).then(() => {
    ['copyStatus','copyStatus2'].forEach(id => {
      const el = document.getElementById(id);
      el.textContent = '✓ تم النسخ!';
      setTimeout(() => el.textContent = 'اضغط للنسخ', 2000);
    });
  });
}

function switchPage(page) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');

  if (isMobile()) {
    const topbar = document.getElementById('mobileTopbar');
    if (page === 'menu') {
      topbar.style.visibility = 'hidden';
    } else {
      topbar.style.visibility = 'visible';
      document.getElementById('mobilePageTitle').textContent = PAGE_TITLES[page] || '';
    }
  }

  if (page === 'menu') renderMenuSummary();
  if (page === 'reports') { renderCharts(); populateFilterOptions(); renderFilteredTransactions(); }
  if (page === 'members') { renderMembers(); fillExchangeRateInputs(); }
  if (page === 'budget') openBudgetPage();
  if (page === 'debts') loadDebts();
  if (page === 'savings') loadSavingsGoals();
}

async function addExpense() {
  const desc = document.getElementById('expDescription').value.trim();
  const amount = parseFloat(document.getElementById('expAmount').value);
  const currency = document.getElementById('expCurrency').value;
  const category = selectedExpCategory;

  if (!desc || !amount) { showAlert('errorAlert', 'الرجاء ملء جميع الحقول'); return; }

  try {
    await db.collection('families').doc(currentFamily.code).collection('transactions').add({
      description: desc, amount, currency, type: 'expense', category,
      addedBy: currentUser.displayName, addedByUid: currentUser.uid,
      date: firebase.firestore.FieldValue.serverTimestamp()
    });
    document.getElementById('expDescription').value = '';
    document.getElementById('expAmount').value = '';
    showAlert('successAlert', 'تم إضافة المصروف بنجاح');
    loadAllData();
  } catch (e) { showAlert('errorAlert', 'خطأ: ' + e.message); }
}

async function addIncome() {
  const desc = document.getElementById('incDescription').value.trim();
  const amount = parseFloat(document.getElementById('incAmount').value);
  const currency = document.getElementById('incCurrency').value;
  const source = selectedIncomeSource;

  if (!desc || !amount) { showAlert('errorAlert', 'الرجاء ملء جميع الحقول'); return; }

  try {
    await db.collection('families').doc(currentFamily.code).collection('transactions').add({
      description: desc, amount, currency, type: 'income', category: source,
      addedBy: currentUser.displayName, addedByUid: currentUser.uid,
      date: firebase.firestore.FieldValue.serverTimestamp()
    });
    document.getElementById('incDescription').value = '';
    document.getElementById('incAmount').value = '';
    showAlert('successAlert', 'تم إضافة الدخل بنجاح');
    loadAllData();
  } catch (e) { showAlert('errorAlert', 'خطأ: ' + e.message); }
}

async function deleteTransaction(docId) {
  if (!confirm('هل متأكد من الحذف؟')) return;
  try {
    await db.collection('families').doc(currentFamily.code).collection('transactions').doc(docId).delete();
    showAlert('successAlert', 'تم الحذف');
    loadAllData();
  } catch (e) { showAlert('errorAlert', 'خطأ: ' + e.message); }
}

async function loadAllData() {
  try {
    const snapshot = await db.collection('families').doc(currentFamily.code)
      .collection('transactions').orderBy('date', 'desc').limit(200).get();

    allTransactions = [];
    snapshot.forEach(doc => allTransactions.push({ id: doc.id, ...doc.data() }));

    renderDashboard();
    renderExpensesTable();
    renderIncomeTable();
    if (document.getElementById('page-reports').classList.contains('active')) renderCharts();
  } catch (e) {
    showAlert('errorAlert', 'خطأ في تحميل البيانات: ' + e.message);
  }
}

function formatDate(ts) {
  return ts ? ts.toDate().toLocaleDateString('en-GB') : '--';
}
function fmt(n) { return Number(n).toFixed(2); }

function renderDashboard() {
  let income = 0, expense = 0;
  allTransactions.forEach(t => {
    const val = toBase(t.amount, t.currency);
    t.type === 'income' ? income += val : expense += val;
  });

  document.getElementById('dashIncome').textContent = fmt(income) + ' ₪';
  document.getElementById('dashExpense').textContent = fmt(expense) + ' ₪';
  document.getElementById('dashBalance').textContent = fmt(income - expense) + ' ₪';

  const recentBody = document.getElementById('dashRecentBody');
  const recent = allTransactions.slice(0, 5);
  if (recent.length === 0) {
    recentBody.innerHTML = '<tr><td colspan="4" class="empty-msg">لا توجد معاملات</td></tr>';
  } else {
    recentBody.innerHTML = recent.map(t => `
      <tr>
        <td>${formatDate(t.date)}</td>
        <td>${t.description}</td>
        <td class="${t.type === 'expense' ? 'amount-expense' : 'amount-income'}">
          ${t.type === 'expense' ? '-' : '+'}${fmt(t.amount)} ${t.currency}
        </td>
        <td>${t.addedBy || '--'}</td>
      </tr>`).join('');
  }
}

function renderExpensesTable() {
  const expenses = allTransactions.filter(t => t.type === 'expense');
  const body = document.getElementById('expensesBody');
  if (expenses.length === 0) {
    body.innerHTML = '<tr><td colspan="6" class="empty-msg">لا توجد مصاريف</td></tr>';
    return;
  }
  body.innerHTML = expenses.map(t => `
    <tr>
      <td>${formatDate(t.date)}</td>
      <td>${t.description}</td>
      <td>${t.category || '--'}</td>
      <td class="amount-expense">-${fmt(t.amount)} ${t.currency}</td>
      <td>${t.addedBy || '--'}</td>
      <td><button class="delete-btn" onclick="deleteTransaction('${t.id}')">حذف</button></td>
    </tr>`).join('');
}

function renderIncomeTable() {
  const incomeList = allTransactions.filter(t => t.type === 'income');
  const body = document.getElementById('incomeBody');
  if (incomeList.length === 0) {
    body.innerHTML = '<tr><td colspan="6" class="empty-msg">لا يوجد دخل</td></tr>';
    return;
  }
  body.innerHTML = incomeList.map(t => `
    <tr>
      <td>${formatDate(t.date)}</td>
      <td>${t.description}</td>
      <td>${t.category || '--'}</td>
      <td class="amount-income">+${fmt(t.amount)} ${t.currency}</td>
      <td>${t.addedBy || '--'}</td>
      <td><button class="delete-btn" onclick="deleteTransaction('${t.id}')">حذف</button></td>
    </tr>`).join('');
}

function renderCharts() {
  const expenses = allTransactions.filter(t => t.type === 'expense');
  const categoryTotals = {};
  expenses.forEach(t => {
    const cat = t.category || 'أخرى';
    categoryTotals[cat] = (categoryTotals[cat] || 0) + t.amount;
  });

  const catCtx = document.getElementById('categoryChart').getContext('2d');
  if (categoryChartInstance) categoryChartInstance.destroy();
  categoryChartInstance = new Chart(catCtx, {
    type: 'doughnut',
    data: {
      labels: Object.keys(categoryTotals),
      datasets: [{
        data: Object.values(categoryTotals),
        backgroundColor: ['#1e3a5f','#0ea5e9','#ef4444','#f59e0b','#10b981','#8b5cf6','#ec4899','#14b8a6','#f97316']
      }]
    },
    options: { responsive:true, plugins:{ legend:{ position:'bottom' } } }
  });

  let income = 0, expenseTotal = 0;
  allTransactions.forEach(t => t.type === 'income' ? income += t.amount : expenseTotal += t.amount);

  const ieCtx = document.getElementById('incomeExpenseChart').getContext('2d');
  if (incomeExpenseChartInstance) incomeExpenseChartInstance.destroy();
  incomeExpenseChartInstance = new Chart(ieCtx, {
    type: 'bar',
    data: {
      labels: ['الدخل', 'المصاريف'],
      datasets: [{ data:[income, expenseTotal], backgroundColor:['#10b981','#ef4444'] }]
    },
    options: { responsive:true, plugins:{ legend:{ display:false } } }
  });
}

async function renderMembers() {
  try {
    const famDoc = await db.collection('families').doc(currentFamily.code).get();
    const members = famDoc.data().members || [];
    currentFamily.members = members;

    document.getElementById('memberCount').textContent = members.length;
    document.getElementById('membersList').innerHTML = members.map(m => `
      <div class="member-row">
        <div class="member-info">
          <div class="member-avatar">${(m.name || '?').charAt(0).toUpperCase()}</div>
          <div>
            <div style="font-weight:600;">${m.name}${m.uid === currentFamily.createdBy ? ' 👑' : ''}</div>
            <div style="font-size:.8rem; color:#6b7280;">${m.email}</div>
          </div>
        </div>
      </div>`).join('');

    document.getElementById('memberLimitNote').style.display = members.length >= MAX_FAMILY_MEMBERS ? 'block' : 'none';

    // طلبات الانضمام: تظهر وتشتغل فقط لمسؤول العيلة (createdBy) — لغير الأدمن هذا الطلب مرفوض من الـ Firestore Rules عمداً
    const isAdmin = currentUser.uid === currentFamily.createdBy;
    const joinCard = document.getElementById('joinRequestsCard');
    if (!isAdmin) { joinCard.style.display = 'none'; return; }

    const reqSnap = await db.collection('families').doc(currentFamily.code).collection('joinRequests').get();
    if (reqSnap.empty) { joinCard.style.display = 'none'; return; }

    joinCard.style.display = 'block';
    document.getElementById('joinRequestsList').innerHTML = reqSnap.docs.map(doc => {
      const r = doc.data();
      return `
      <div class="member-row">
        <div class="member-info">
          <div class="member-avatar">${(r.name || '?').charAt(0).toUpperCase()}</div>
          <div>
            <div style="font-weight:600;">${r.name}</div>
            <div style="font-size:.8rem; color:#6b7280;">${r.email}</div>
          </div>
        </div>
        <div style="display:flex; gap:6px;">
          <button class="btn btn-small" style="width:auto; background:var(--success);" onclick="approveJoinRequest('${r.uid}','${r.name}','${r.email}')">✓ قبول</button>
          <button class="delete-btn" onclick="rejectJoinRequest('${r.uid}')">✕ رفض</button>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    showAlert('errorAlert', 'خطأ في تحميل الأعضاء: ' + e.message);
  }
}

async function approveJoinRequest(uid, name, email) {
  try {
    if ((currentFamily.members || []).length >= MAX_FAMILY_MEMBERS) {
      showAlert('errorAlert', `وصلتوا الحد الأقصى (${MAX_FAMILY_MEMBERS} أشخاص)`);
      return;
    }
    const members = [...(currentFamily.members || []), { uid, name, email }];
    const memberUids = [...(currentFamily.memberUids || []), uid];
    await db.collection('families').doc(currentFamily.code).update({ members, memberUids });
    await db.collection('families').doc(currentFamily.code).collection('joinRequests').doc(uid).delete();
    currentFamily.members = members;
    currentFamily.memberUids = memberUids;
    showAlert('successAlert', 'تم قبول ' + name + ' بالعيلة');
    renderMembers();
  } catch (e) { showAlert('errorAlert', 'خطأ بالقبول: ' + e.message); }
}

async function rejectJoinRequest(uid) {
  try {
    await db.collection('families').doc(currentFamily.code).collection('joinRequests').doc(uid).delete();
    showAlert('successAlert', 'تم رفض الطلب');
    renderMembers();
  } catch (e) { showAlert('errorAlert', 'خطأ بالرفض: ' + e.message); }
}

async function openBudgetPage() {
  await loadBudgets();
  renderBudgetPage();
}

async function loadBudgets() {
  try {
    const famDoc = await db.collection('families').doc(currentFamily.code).get();
    budgetLimits = (famDoc.exists && famDoc.data().budgetLimits) || {};
  } catch (e) { budgetLimits = {}; }
}

function currentMonthExpenses() {
  const now = new Date();
  return allTransactions.filter(t => {
    if (t.type !== 'expense' || !t.date) return false;
    const d = t.date.toDate();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
}

function renderBudgetPage() {
  const monthExpenses = currentMonthExpenses();
  const spentByCategory = {};
  monthExpenses.forEach(t => { spentByCategory[t.category] = (spentByCategory[t.category] || 0) + toBase(t.amount, t.currency); });

  let totalLimit = 0, totalSpent = 0;
  EXPENSE_CATEGORIES.forEach(cat => {
    totalLimit += budgetLimits[cat.value] || 0;
    totalSpent += spentByCategory[cat.value] || 0;
  });

  document.getElementById('budgetSummary').innerHTML = `
    <div class="summary-grid">
      <div class="summary-box"><div class="label">مجموع الأسقف المحددة</div><div class="value" style="color:var(--primary);">${fmt(totalLimit)}</div></div>
      <div class="summary-box expense"><div class="label">إجمالي مصروف الشهر</div><div class="value">${fmt(totalSpent)}</div></div>
    </div>`;

  document.getElementById('budgetList').innerHTML = EXPENSE_CATEGORIES.map(cat => {
    const limit = budgetLimits[cat.value] || 0;
    const spent = spentByCategory[cat.value] || 0;
    const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
    const barClass = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok';
    return `
      <div class="budget-card">
        <div class="budget-row-top">
          <div class="cat-name">${cat.icon} ${cat.value}</div>
          <input type="number" class="budget-limit-input" placeholder="حدد سقف" min="0" step="10"
            value="${limit || ''}" onchange="saveBudgetLimit('${cat.value}', this.value)">
        </div>
        ${limit > 0 ? `
          <div class="budget-bar-track"><div class="budget-bar-fill ${barClass}" style="width:${pct}%"></div></div>
          <div class="budget-row-nums">
            <span>${fmt(spent)} من ${fmt(limit)}</span>
            <span>${pct.toFixed(0)}%</span>
          </div>` : `
          <div class="budget-row-nums">
            <span>مصروف الشهر: ${fmt(spent)}</span>
            <span class="no-limit-badge">بدون سقف</span>
          </div>`}
      </div>`;
  }).join('');
}

async function saveBudgetLimit(category, value) {
  const num = parseFloat(value) || 0;
  budgetLimits[category] = num;
  try {
    await db.collection('families').doc(currentFamily.code).set({ budgetLimits }, { merge: true });
    showAlert('successAlert', 'تم حفظ سقف ' + category);
  } catch (e) { showAlert('errorAlert', 'خطأ بالحفظ: ' + e.message); }
}

function populateFilterOptions() {
  const monthSelect = document.getElementById('filterMonth');
  const monthsSet = new Set();
  allTransactions.forEach(t => {
    if (t.date) {
      const d = t.date.toDate();
      monthsSet.add(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
    }
  });
  const months = Array.from(monthsSet).sort().reverse();
  const prevMonth = monthSelect.value;
  monthSelect.innerHTML = '<option value="all">كل الشهور</option>' +
    months.map(m => `<option value="${m}">${m}</option>`).join('');
  if (months.includes(prevMonth)) monthSelect.value = prevMonth;

  const memberSelect = document.getElementById('filterMember');
  const prevMember = memberSelect.value;
  const members = (currentFamily.members || []);
  memberSelect.innerHTML = '<option value="all">الكل</option>' +
    members.map(m => `<option value="${m.name}">${m.name}</option>`).join('');
  if (members.some(m => m.name === prevMember)) memberSelect.value = prevMember;
}

function getFilteredTransactions() {
  const type = document.getElementById('filterType').value;
  const month = document.getElementById('filterMonth').value;
  const member = document.getElementById('filterMember').value;
  return allTransactions.filter(t => {
    if (type !== 'all' && t.type !== type) return false;
    if (member !== 'all' && t.addedBy !== member) return false;
    if (month !== 'all' && t.date) {
      const d = t.date.toDate();
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      if (key !== month) return false;
    }
    return true;
  });
}

function renderFilteredTransactions() {
  const rows = getFilteredTransactions();
  let income = 0, expense = 0;
  rows.forEach(t => { const val = toBase(t.amount, t.currency); t.type === 'income' ? income += val : expense += val; });
  document.getElementById('filterIncome').textContent = fmt(income) + ' ₪';
  document.getElementById('filterExpense').textContent = fmt(expense) + ' ₪';
  document.getElementById('filterBalance').textContent = fmt(income - expense) + ' ₪';

  const body = document.getElementById('filteredTransactionsBody');
  if (rows.length === 0) {
    body.innerHTML = '<tr><td colspan="6" class="empty-msg">لا توجد بيانات</td></tr>';
    return;
  }
  body.innerHTML = rows.map(t => `
    <tr>
      <td>${formatDate(t.date)}</td>
      <td>${t.description}</td>
      <td>${t.category || '--'}</td>
      <td>${t.type === 'expense' ? 'مصروف' : 'دخل'}</td>
      <td class="${t.type === 'expense' ? 'amount-expense' : 'amount-income'}">${t.type === 'expense' ? '-' : '+'}${fmt(t.amount)} ${t.currency}</td>
      <td>${t.addedBy || '--'}</td>
    </tr>`).join('');
}

function exportFilteredToExcel() {
  const rows = getFilteredTransactions();
  if (rows.length === 0) { showAlert('errorAlert', 'لا توجد بيانات للتصدير حسب الفلتر الحالي'); return; }
  const data = rows.map(t => ({
    'التاريخ': formatDate(t.date),
    'الوصف': t.description,
    'التصنيف/المصدر': t.category || '',
    'النوع': t.type === 'expense' ? 'مصروف' : 'دخل',
    'المبلغ': t.amount,
    'العملة': t.currency,
    'بواسطة': t.addedBy || ''
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'الحركات');
  XLSX.writeFile(wb, `مصاريف-البيت-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function exportFilteredToPDF() {
  const rows = getFilteredTransactions();
  if (rows.length === 0) { showAlert('errorAlert', 'لا توجد بيانات للتصدير حسب الفلتر الحالي'); return; }
  let income = 0, expense = 0;
  rows.forEach(t => t.type === 'income' ? income += t.amount : expense += t.amount);
  const tableRows = rows.map(t => `
    <tr>
      <td>${formatDate(t.date)}</td>
      <td>${t.description}</td>
      <td>${t.category || '--'}</td>
      <td>${t.type === 'expense' ? 'مصروف' : 'دخل'}</td>
      <td>${fmt(t.amount)} ${t.currency}</td>
      <td>${t.addedBy || '--'}</td>
    </tr>`).join('');
  document.getElementById('printArea').innerHTML = `
    <h2 style="text-align:center;">تقرير مصاريف البيت — ${currentFamily.name}</h2>
    <p style="text-align:center; color:#555;">تاريخ التقرير: ${new Date().toLocaleDateString('en-GB')}</p>
    <p><b>إجمالي الدخل:</b> ${fmt(income)} &nbsp;|&nbsp; <b>إجمالي المصروف:</b> ${fmt(expense)} &nbsp;|&nbsp; <b>الصافي:</b> ${fmt(income - expense)}</p>
    <table>
      <thead><tr><th>التاريخ</th><th>الوصف</th><th>التصنيف/المصدر</th><th>النوع</th><th>المبلغ</th><th>بواسطة</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>`;
  window.print();
}

let savingsGoals = [];

async function loadSavingsGoals() {
  try {
    const snap = await db.collection('families').doc(currentFamily.code)
      .collection('savingsGoals').orderBy('createdAt', 'desc').get();
    savingsGoals = [];
    snap.forEach(doc => savingsGoals.push({ id: doc.id, ...doc.data() }));
    renderSavingsGoals();
  } catch (e) { showAlert('errorAlert', 'خطأ في تحميل خطط التوفير: ' + e.message); }
}

function renderSavingsGoals() {
  const container = document.getElementById('savingsGoalsList');
  if (savingsGoals.length === 0) {
    container.innerHTML = '<div class="card"><p class="empty-msg">لا توجد أهداف توفير بعد</p></div>';
    return;
  }
  container.innerHTML = savingsGoals.map(g => {
    const pct = g.target > 0 ? Math.min(100, (g.saved / g.target) * 100) : 0;
    return `
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <h3 style="margin:0;">${g.name}</h3>
          <button class="delete-btn" onclick="deleteSavingsGoal('${g.id}')">حذف</button>
        </div>
        <div class="budget-bar-track"><div class="budget-bar-fill ${pct >= 100 ? 'ok' : 'warn'}" style="width:${pct}%"></div></div>
        <div class="budget-row-nums">
          <span>${fmt(g.saved || 0)} ${g.currency}</span>
          <span>الهدف: ${fmt(g.target)} ${g.currency} (${pct.toFixed(0)}%)</span>
        </div>
        <div class="form-row" style="margin-top:12px;">
          <input type="number" id="contrib-${g.id}" placeholder="مبلغ المساهمة" min="0" step="10">
          <button class="btn btn-small" style="width:auto;" onclick="addSavingsContribution('${g.id}')">إضافة مساهمة</button>
        </div>
      </div>`;
  }).join('');
}

async function createSavingsGoal() {
  const name = document.getElementById('savingsGoalName').value.trim();
  const target = parseFloat(document.getElementById('savingsGoalTarget').value);
  const currency = document.getElementById('savingsGoalCurrency').value;
  if (!name || !target) { showAlert('errorAlert', 'الرجاء ملء اسم الهدف والمبلغ المستهدف'); return; }
  try {
    await db.collection('families').doc(currentFamily.code).collection('savingsGoals').add({
      name, target, currency, saved: 0,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    document.getElementById('savingsGoalName').value = '';
    document.getElementById('savingsGoalTarget').value = '';
    showAlert('successAlert', 'تم إنشاء الهدف');
    loadSavingsGoals();
  } catch (e) { showAlert('errorAlert', 'خطأ: ' + e.message); }
}

async function addSavingsContribution(goalId) {
  const input = document.getElementById('contrib-' + goalId);
  const amount = parseFloat(input.value);
  if (!amount || amount <= 0) { showAlert('errorAlert', 'أدخل مبلغ مساهمة صحيح'); return; }
  try {
    const goal = savingsGoals.find(g => g.id === goalId);
    const newSaved = (goal.saved || 0) + amount;
    await db.collection('families').doc(currentFamily.code).collection('savingsGoals').doc(goalId)
      .update({ saved: newSaved });
    showAlert('successAlert', 'تم إضافة المساهمة');
    loadSavingsGoals();
  } catch (e) { showAlert('errorAlert', 'خطأ: ' + e.message); }
}

async function deleteSavingsGoal(goalId) {
  if (!confirm('هل متأكد من حذف هذا الهدف؟')) return;
  try {
    await db.collection('families').doc(currentFamily.code).collection('savingsGoals').doc(goalId).delete();
    showAlert('successAlert', 'تم الحذف');
    loadSavingsGoals();
  } catch (e) { showAlert('errorAlert', 'خطأ: ' + e.message); }
}

async function loadExchangeRates() {
  try {
    const famDoc = await db.collection('families').doc(currentFamily.code).get();
    const rates = famDoc.data().exchangeRates;
    if (rates) exchangeRates = { ...exchangeRates, ...rates };
  } catch (e) { /* استخدم القيم الافتراضية بصمت */ }
}

function fillExchangeRateInputs() {
  document.getElementById('rateUSD').value = exchangeRates.USD || '';
  document.getElementById('rateJOD').value = exchangeRates.JOD || '';
  document.getElementById('rateSAR').value = exchangeRates.SAR || '';
}

async function saveExchangeRates() {
  const rates = {
    USD: parseFloat(document.getElementById('rateUSD').value) || exchangeRates.USD,
    JOD: parseFloat(document.getElementById('rateJOD').value) || exchangeRates.JOD,
    SAR: parseFloat(document.getElementById('rateSAR').value) || exchangeRates.SAR
  };
  try {
    await db.collection('families').doc(currentFamily.code).set({ exchangeRates: rates }, { merge: true });
    exchangeRates = rates;
    showAlert('successAlert', 'تم حفظ أسعار الصرف');
    renderDashboard();
  } catch (e) { showAlert('errorAlert', 'خطأ: ' + e.message); }
}

function renderMenuSummary() {
  const now = new Date();
  let income = 0, expense = 0;
  allTransactions.forEach(t => {
    if (!t.date) return;
    const d = t.date.toDate();
    if (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear()) return;
    const val = toBase(t.amount, t.currency);
    t.type === 'income' ? income += val : expense += val;
  });
  document.getElementById('menuIncome').textContent = fmt(income) + ' ₪';
  document.getElementById('menuExpense').textContent = fmt(expense) + ' ₪';
  document.getElementById('menuBalance').textContent = fmt(income - expense) + ' ₪';
}

async function loadDebts() {
  try {
    const snap = await db.collection('families').doc(currentFamily.code)
      .collection('debts').orderBy('createdAt', 'desc').get();
    debts = [];
    snap.forEach(doc => debts.push({ id: doc.id, ...doc.data() }));
    renderDebtsPage();
  } catch (e) { showAlert('errorAlert', 'خطأ في تحميل الديون: ' + e.message); }
}

function renderDebtsPage() {
  const container = document.getElementById('debtsList');
  if (debts.length === 0) {
    container.innerHTML = '<div class="card"><p class="empty-msg">لا توجد ديون مسجّلة 🎉</p></div>';
    return;
  }
  container.innerHTML = debts.map(d => {
    const total = d.totalAmount || 0;
    const remaining = d.remainingAmount != null ? d.remainingAmount : total;
    const pct = total > 0 ? Math.min(100, ((total - remaining) / total) * 100) : 0;
    const done = remaining <= 0;
    return `
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <h3 style="margin:0;">${d.name} ${done ? '✅' : ''}</h3>
          <button class="delete-btn" onclick="deleteDebt('${d.id}')">حذف</button>
        </div>
        <div class="budget-bar-track"><div class="budget-bar-fill ${done ? 'ok' : 'warn'}" style="width:${pct}%"></div></div>
        <div class="budget-row-nums">
          <span>المتبقي: ${fmt(remaining)} ${d.currency}</span>
          <span>الإجمالي: ${fmt(total)} ${d.currency} (${pct.toFixed(0)}% مسدّد)</span>
        </div>
        <div class="budget-row-nums">
          <span>القسط الشهري: ${fmt(d.monthlyPayment)} ${d.currency}</span>
          <span>الاستحقاق: يوم ${d.dueDay} من كل شهر</span>
        </div>
        ${!done ? `
        <div class="form-row" style="margin-top:12px;">
          <input type="number" id="debtPay-${d.id}" placeholder="مبلغ الدفعة" min="0" step="10" value="${d.monthlyPayment || ''}">
          <button class="btn btn-small" style="width:auto;" onclick="payDebtInstallment('${d.id}')">💳 تسديد قسط (يُسجَّل كمصروف)</button>
        </div>` : ''}
      </div>`;
  }).join('');
}

async function createDebt() {
  const name = document.getElementById('debtName').value.trim();
  const totalAmount = parseFloat(document.getElementById('debtTotal').value);
  const monthlyPayment = parseFloat(document.getElementById('debtMonthly').value);
  const dueDay = parseInt(document.getElementById('debtDueDay').value);
  const currency = document.getElementById('debtCurrency').value;

  if (!name || !totalAmount || !monthlyPayment || !dueDay) {
    showAlert('errorAlert', 'الرجاء ملء كل الحقول');
    return;
  }
  try {
    await db.collection('families').doc(currentFamily.code).collection('debts').add({
      name, totalAmount, remainingAmount: totalAmount, monthlyPayment, dueDay, currency,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    document.getElementById('debtName').value = '';
    document.getElementById('debtTotal').value = '';
    document.getElementById('debtMonthly').value = '';
    document.getElementById('debtDueDay').value = '';
    showAlert('successAlert', 'تم إضافة الدين');
    loadDebts();
  } catch (e) { showAlert('errorAlert', 'خطأ: ' + e.message); }
}

async function payDebtInstallment(debtId) {
  const debt = debts.find(d => d.id === debtId);
  const input = document.getElementById('debtPay-' + debtId);
  const amount = parseFloat(input.value);
  if (!amount || amount <= 0) { showAlert('errorAlert', 'أدخل مبلغ دفعة صحيح'); return; }
  try {
    await db.collection('families').doc(currentFamily.code).collection('transactions').add({
      description: 'قسط: ' + debt.name, amount, currency: debt.currency, type: 'expense', category: 'ديون',
      addedBy: currentUser.displayName, addedByUid: currentUser.uid,
      date: firebase.firestore.FieldValue.serverTimestamp()
    });
    const newRemaining = Math.max(0, (debt.remainingAmount != null ? debt.remainingAmount : debt.totalAmount) - amount);
    await db.collection('families').doc(currentFamily.code).collection('debts').doc(debtId)
      .update({ remainingAmount: newRemaining });
    showAlert('successAlert', 'تم تسجيل الدفعة كمصروف هالشهر');
    loadAllData();
    loadDebts();
  } catch (e) { showAlert('errorAlert', 'خطأ: ' + e.message); }
}

async function deleteDebt(debtId) {
  if (!confirm('هل متأكد من حذف هذا الدين؟ (هذا ما بيحذف المصاريف المسجّلة سابقاً)')) return;
  try {
    await db.collection('families').doc(currentFamily.code).collection('debts').doc(debtId).delete();
    showAlert('successAlert', 'تم الحذف');
    loadDebts();
  } catch (e) { showAlert('errorAlert', 'خطأ: ' + e.message); }
}

function showAlert(id, message) {
  const alert = document.getElementById(id);
  alert.textContent = message;
  alert.classList.add('show');
  setTimeout(() => alert.classList.remove('show'), 3000);
}

// تعريض الدوال على window لأن onclick/onchange بالـ HTML يحتاجها عالمياً (ES Modules لا تفعل هذا تلقائياً)
window.addExpense = addExpense;
window.addIncome = addIncome;
window.addSavingsContribution = addSavingsContribution;
window.approveJoinRequest = approveJoinRequest;
window.copyCode = copyCode;
window.createDebt = createDebt;
window.createFamily = createFamily;
window.createSavingsGoal = createSavingsGoal;
window.deleteDebt = deleteDebt;
window.deleteSavingsGoal = deleteSavingsGoal;
window.deleteTransaction = deleteTransaction;
window.exportFilteredToExcel = exportFilteredToExcel;
window.exportFilteredToPDF = exportFilteredToPDF;
window.goToMenu = goToMenu;
window.joinFamily = joinFamily;
window.logout = logout;
window.payDebtInstallment = payDebtInstallment;
window.rejectJoinRequest = rejectJoinRequest;
window.renderFilteredTransactions = renderFilteredTransactions;
window.saveBudgetLimit = saveBudgetLimit;
window.saveExchangeRates = saveExchangeRates;
window.selectExpCategory = selectExpCategory;
window.selectIncomeSource = selectIncomeSource;
window.showCreateForm = showCreateForm;
window.showFamilyScreen = showFamilyScreen;
window.showJoinForm = showJoinForm;
window.switchPage = switchPage;

