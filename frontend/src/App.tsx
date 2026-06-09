import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router";
import Home from "./pages/Home";

/**
 * Route-level code splitting.
 *
 * Only Home is eager — it's the public LCP target and we don't want to
 * add a network round-trip to the most-visited page.
 *
 * Everything else is lazy, including ProtectedRoute. ProtectedRoute itself
 * is tiny, but it imports `@/lib/supabase`, which transitively pulls the
 * entire `@supabase/supabase-js` client (~80-100 KB gzip) into whatever
 * chunk owns it. Lazy-loading the guard pushes Supabase out of the main
 * bundle and into a shared chunk used only by authenticated paths, where
 * the user has already committed to a login round-trip.
 *
 * Trade-off: a brief Suspense fallback before any /search, /dashboard, or
 * /auth route mounts. The fallback intentionally mirrors ProtectedRoute's
 * own spinner so the two loading states blend visually.
 */
const Auth = lazy(() => import("./pages/Auth"));
const AuthCallback = lazy(() => import("./pages/AuthCallback"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const SearchPage = lazy(() => import("./pages/SearchPage"));
const AppLayout = lazy(() => import("./components/layout/AppLayout"));
const ProtectedRoute = lazy(() => import("./components/ProtectedRoute"));

/**
 * Suspense fallback intentionally matches the spinner used in ProtectedRoute
 * so the user perceives one consistent "loading shell" regardless of whether
 * we're waiting on a code chunk or a session check.
 */
function RouteFallback() {
    return (
        <div className="flex min-h-screen items-center justify-center">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
    );
}

export function App() {
    useEffect(() => {
        document.documentElement.classList.add("dark");
    }, []);

    return (
        <BrowserRouter>
            <Suspense fallback={<RouteFallback />}>
                <Routes>
                    <Route path="/auth" element={<Auth />} />
                    <Route path="/auth/callback" element={<AuthCallback />} />
                    <Route path="/" element={<Home />} />
                    <Route
                        path="/search"
                        element={
                            <ProtectedRoute>
                                <AppLayout>
                                    <SearchPage />
                                </AppLayout>
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/search/:conversationId"
                        element={
                            <ProtectedRoute>
                                <AppLayout>
                                    <SearchPage />
                                </AppLayout>
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/dashboard"
                        element={
                            <ProtectedRoute>
                                <Dashboard />
                            </ProtectedRoute>
                        }
                    />
                </Routes>
            </Suspense>
        </BrowserRouter>
    );
}

export default App;
