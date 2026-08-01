// ثوابت مشتركة: إعدادات جوجل، حد أقصى للأعضاء، تصنيفات المصاريف، عناوين الصفحات
export const GOOGLE_CLIENT_ID = '422644628562-m5oiduvhph3grtdvheogrtt0ilr06143.apps.googleusercontent.com';
export const MAX_FAMILY_MEMBERS = 5;

export const EXPENSE_CATEGORIES = [
  {value:'غذاء', icon:'🍔'}, {value:'مواصلات', icon:'🚗'}, {value:'إيجار', icon:'🏠'},
  {value:'فواتير', icon:'💡'}, {value:'ملابس', icon:'👕'}, {value:'تعليم', icon:'📚'},
  {value:'صحة', icon:'⚕️'}, {value:'ترفيه', icon:'🎬'}, {value:'أخرى', icon:'📌'}, {value:'ديون', icon:'💳'}
];

export const PAGE_TITLES = {
  dashboard:'لوحة التحكم', expenses:'المصاريف', income:'الدخل', reports:'التقارير',
  budget:'الموازنة', debts:'الديون', savings:'التوفير', members:'أعضاء العيلة'
};

