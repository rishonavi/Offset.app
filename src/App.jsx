import { Suspense, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { DataProvider } from './context/DataContext'
import { WorkspaceProvider } from './context/WorkspaceContext'
import { PlanProvider } from './context/PlanContext'
import { PersonalProvider } from './context/PersonalContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import { Spinner } from './components/ui'

const Login = lazy(() => import('./pages/Login'))
const Landing = lazy(() => import('./pages/Landing'))
const Pricing = lazy(() => import('./pages/Pricing'))
const Terms = lazy(() => import('./pages/Legal').then((m) => ({ default: m.Terms })))
const Privacy = lazy(() => import('./pages/Legal').then((m) => ({ default: m.Privacy })))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Properties = lazy(() => import('./pages/Properties'))
const PropertyDetail = lazy(() => import('./pages/PropertyDetail'))
const AssetFormPage = lazy(() => import('./pages/AssetFormPage'))
const Expenses = lazy(() => import('./pages/Expenses'))
const ExpenseFormPage = lazy(() => import('./pages/ExpenseFormPage'))
const Income = lazy(() => import('./pages/Income'))
const IncomeFormPage = lazy(() => import('./pages/IncomeFormPage'))
const Bills = lazy(() => import('./pages/Bills'))
const ImportBills = lazy(() => import('./pages/ImportBills'))
const Reports = lazy(() => import('./pages/Reports'))
const Settings = lazy(() => import('./pages/Settings'))
const Admin = lazy(() => import('./pages/Admin'))
const Personal = lazy(() => import('./pages/Personal'))

export default function App() {
  const { isCloud } = useAuth()

  return (
    <Routes>
      <Route
        path="/login"
        element={
          isCloud ? (
            <Suspense fallback={<FullScreen />}>
              <Login />
            </Suspense>
          ) : (
            <Navigate to="/" replace />
          )
        }
      />

      {/* Public marketing / legal */}
      <Route
        path="/welcome"
        element={
          <Suspense fallback={<FullScreen />}>
            <Landing />
          </Suspense>
        }
      />
      <Route
        path="/pricing"
        element={
          <Suspense fallback={<FullScreen />}>
            <Pricing />
          </Suspense>
        }
      />
      <Route
        path="/terms"
        element={
          <Suspense fallback={<FullScreen />}>
            <Terms />
          </Suspense>
        }
      />
      <Route
        path="/privacy"
        element={
          <Suspense fallback={<FullScreen />}>
            <Privacy />
          </Suspense>
        }
      />

      <Route
        path="/"
        element={
          <ProtectedRoute>
            <WorkspaceProvider>
              <DataProvider>
                <PlanProvider>
                  <PersonalProvider>
                    <Layout />
                  </PersonalProvider>
                </PlanProvider>
              </DataProvider>
            </WorkspaceProvider>
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="properties" element={<Properties />} />
        <Route path="properties/new" element={<AssetFormPage />} />
        <Route path="properties/:id" element={<PropertyDetail />} />
        <Route path="properties/:id/edit" element={<AssetFormPage />} />
        <Route path="expenses" element={<Expenses />} />
        <Route path="expenses/new" element={<ExpenseFormPage />} />
        <Route path="expenses/:id/edit" element={<ExpenseFormPage />} />
        <Route path="income" element={<Income />} />
        <Route path="income/new" element={<IncomeFormPage />} />
        <Route path="income/:id/edit" element={<IncomeFormPage />} />
        <Route path="bills" element={<Bills />} />
        <Route path="import" element={<ImportBills />} />
        <Route path="reports" element={<Reports />} />
        <Route path="settings" element={<Settings />} />
        <Route path="personal" element={<Personal />} />
        <Route path="admin" element={<Admin />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function FullScreen() {
  return (
    <div className="grid min-h-screen place-items-center">
      <Spinner />
    </div>
  )
}
