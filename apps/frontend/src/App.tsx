import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { ROUTES } from './navigation';
import { AppShell } from './components/shell/AppShell';
import { RequireRole, DefaultRedirect } from './routes/RequireRole';
import { Login } from './pages/Login';
import { Library } from './pages/Library';
import { Publish } from './pages/Publish';
import { Operations } from './pages/Operations';
import { StudentHome } from './pages/StudentHome';
import { MyProgress } from './pages/MyProgress';
import { TeacherDashboard } from './pages/TeacherDashboard';
import { Courses } from './pages/courses/Courses';
import { CourseDetail } from './pages/courses/CourseDetail';
import { CourseForm } from './pages/courses/CourseForm';

/**
 * Routing. Each authenticated route is guarded by the roles declared in
 * navigation.ts.
 */
export function App() {
  const { session, status } = useAuth();

  // Validating a stored token with /auth/me — avoid flashing the wrong page.
  if (status === 'checking') {
    return (
      <div className="cq-splash" role="status">
        Checking your session…
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={session ? <DefaultRedirect /> : <Login />} />

      <Route
        element={
          <RequireRole roles={['student', 'teacher', 'admin']}>
            <AppShell />
          </RequireRole>
        }
      >
        <Route
          path={ROUTES.home.path}
          element={
            <RequireRole roles={ROUTES.home.roles}>
              <StudentHome />
            </RequireRole>
          }
        />
        <Route
          path={ROUTES.progress.path}
          element={
            <RequireRole roles={ROUTES.progress.roles}>
              <MyProgress />
            </RequireRole>
          }
        />
        <Route
          path={ROUTES.dashboard.path}
          element={
            <RequireRole roles={ROUTES.dashboard.roles}>
              <TeacherDashboard />
            </RequireRole>
          }
        />
        <Route
          path={ROUTES.courses.path}
          element={
            <RequireRole roles={ROUTES.courses.roles}>
              <Courses />
            </RequireRole>
          }
        />
        <Route
          path={ROUTES.courseNew.path}
          element={
            <RequireRole roles={ROUTES.courseNew.roles}>
              <CourseForm />
            </RequireRole>
          }
        />
        <Route
          path={ROUTES.courseDetail.path}
          element={
            <RequireRole roles={ROUTES.courseDetail.roles}>
              <CourseDetail />
            </RequireRole>
          }
        />
        <Route
          path={ROUTES.courseEdit.path}
          element={
            <RequireRole roles={ROUTES.courseEdit.roles}>
              <CourseForm key="edit" />
            </RequireRole>
          }
        />
        <Route
          path={ROUTES.courseAddResource.path}
          element={
            <RequireRole roles={ROUTES.courseAddResource.roles}>
              <Publish key="course-resource" />
            </RequireRole>
          }
        />
        <Route
          path={ROUTES.library.path}
          element={
            <RequireRole roles={ROUTES.library.roles}>
              <Library />
            </RequireRole>
          }
        />
        <Route
          path={ROUTES.publish.path}
          element={
            <RequireRole roles={ROUTES.publish.roles}>
              <Publish />
            </RequireRole>
          }
        />
        <Route
          path={ROUTES.operations.path}
          element={
            <RequireRole roles={ROUTES.operations.roles}>
              <Operations />
            </RequireRole>
          }
        />
      </Route>

      <Route path="/" element={<DefaultRedirect />} />
      <Route path="*" element={session ? <DefaultRedirect /> : <Navigate to="/login" replace />} />
    </Routes>
  );
}
