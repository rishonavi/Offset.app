// Loading the PDF libraries, once, for everybody who needs them.
//
// CommonJS reached through a dynamic import comes back wrapped, and how many
// times depends on the package and the bundler: `ns.default` is sometimes the
// function and sometimes the module object with the function inside it. A page
// that imports these statically gets one layer unwrapped for free, which is why
// the usual `.default || module` line works there and not here.
//
// That distinction is the whole reason this file exists. `siteDocsPdf.js` had
// worked it out and written it down; `Reports.jsx` then moved from a static
// import to a dynamic one, kept its `.default || module` line, and broke —
// because the line had been correct for a static import and silently was not
// for a dynamic one. Two copies of a rule this subtle is one of them being
// wrong, so there is one copy now.
export const callable = (module_, name) => {
  let found = module_
  for (let i = 0; i < 4 && found && typeof found !== 'function'; i += 1) found = found.default
  if (typeof found !== 'function') throw new Error(`${name} did not load, so there is nothing to make a PDF with.`)
  return found
}

// Fetched on first use and kept, so a second export does not download it again.
let libs
export const loadPdf = () =>
  (libs ||= Promise.all([import('jspdf'), import('jspdf-autotable')]).then(([pdf, table]) => ({
    jsPDF: callable(pdf, 'The PDF library'),
    autoTable: callable(table, 'The PDF table plugin'),
  })))
