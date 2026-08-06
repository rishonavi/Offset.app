// English — the source of truth. Every other dictionary is measured against
// this one, and anything a translation is missing falls back to here.
//
// Keys are grouped by where the string appears. Keep them descriptive: a
// translator sees the key and the English, and nothing else.
export default {
  // ── Navigation ──
  'nav.dashboard': 'Dashboard',
  'nav.personal': 'Personal',
  'nav.assets': 'Assets',
  'nav.income': 'Income',
  'nav.expenses': 'Expenses',
  'nav.bills': 'Bills',
  'nav.import': 'Import',
  'nav.invoices': 'Invoices',
  'nav.reports': 'Reports & Export',
  'nav.bin': 'Bin',
  'nav.settings': 'Settings',
  'nav.admin': 'Admin',

  // ── Chrome ──
  'chrome.skipToContent': 'Skip to content',
  'chrome.addExpense': 'Add expense',
  'chrome.search': 'Search…',
  'chrome.searchLabel': 'Search',
  'chrome.openMenu': 'Open menu',
  'chrome.closeMenu': 'Close menu',
  'chrome.mainMenu': 'Main menu',
  'chrome.toggleTheme': 'Toggle theme',
  'chrome.switchToLight': 'Switch to light mode',
  'chrome.switchToDark': 'Switch to dark mode',
  'chrome.reportProblem': 'Report a problem',
  'chrome.signOut': 'Sign out',
  'chrome.signedIn': 'Signed in',
  'chrome.demoMode': 'Demo mode',
  'chrome.localUser': 'Local user',
  'chrome.myWorkspace': 'My workspace',
  'chrome.sharedWorkspace': 'Shared · {name}',
  'chrome.switchWorkspace': 'Switch workspace',

  // ── Banners ──
  'banner.readOnlyLead': 'You’re viewing a',
  'banner.readOnlyStrong': 'shared workspace',
  'banner.readOnlyTail': '— read-only.',
  'banner.demoStrong': 'Demo mode',
  'banner.demoBody': '— data is saved only in this browser. Add your Supabase keys in .env for cloud sync, login & receipt storage.',
  'banner.maintenance': 'Offset is undergoing brief maintenance.',

  // ── Shared wording ──
  'common.loading': 'Loading…',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.done': 'Done',
  'common.close': 'Close',
  'common.entries_one': '{count} entry',
  'common.entries_other': '{count} entries',
  'common.assets_one': '{count} asset',
  'common.assets_other': '{count} assets',

  // ── Settings ──
  'settings.title': 'Settings',
  'settings.subtitle': 'Your account, appearance and data.',
  'settings.account': 'Account',
  'settings.appearance': 'Appearance',
  'settings.accessibility': 'Accessibility',
  'settings.team': 'Team & sharing',
  'settings.data': 'Your data',
  'settings.reportProblem': 'Report a problem',
  'settings.newReport': 'New report',

  // ── Language ──
  'language.title': 'Language',
  'language.description': 'Choose the language Offset speaks to you in.',
  'language.label': 'Language',
  'language.systemDefault': 'Match my browser',
  'language.partial': 'Parts of Offset that haven’t been translated yet stay in English.',
  'language.coverage': '{percent}% translated',
  'language.amounts': 'Amounts and dates keep their current format — this changes the wording only.',
  'language.changed': 'Language changed to {name}.',
}
