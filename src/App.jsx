import { useEffect, useRef, useState } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { marked } from "marked";
import {
  createComment,
  deleteComment,
  entityKey,
  fetchEngagementStats,
  formatCount,
  getEntityStats,
  incrementView,
  parseLooseCount,
  toggleLike,
} from "./lib/engagementApi";
import {
  loadProjectDocumentation,
  loadProjectsFromJson,
  loadRepoFile,
  loadRepoProject,
  parseGithubUrl,
  repoSlug,
  rewriteReadmeAssets,
} from "./lib/projectApi";
import {
  fetchAccountProfile,
  fetchAdminProfiles,
  saveAccountProfile,
  updateAdminProfileRole,
} from "./lib/accountApi";
import {
  fetchAdminDashboard,
  fetchPublicContent,
  reviewCommentRequest,
  reviewContentRequest,
  submitContentRequest,
} from "./lib/contentApi";
import {
  clearPendingRequestedRole,
  getAuthRedirectUrl,
  getPendingRequestedRole,
  getSupabaseClient,
  loadSupabaseRuntimeConfig,
  resolveAvatarBucketName,
  resolveSupabasePublishableKey,
  resolveSupabaseUrl,
  setPendingRequestedRole,
} from "./lib/supabaseClient";

function fixText(value) {
  if (typeof value !== "string" || !/[ÂÃâð]/.test(value)) {
    return value;
  }

  try {
    return decodeURIComponent(escape(value));
  } catch {
    return value;
  }
}

function normalizeData(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeData);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeData(item)])
    );
  }

  return fixText(value);
}

function markdownToHtml(markdown) {
  return marked.parse(fixText(markdown || ""));
}

function useJson(url) {
  const [state, setState] = useState({ data: null, error: null, loading: true });

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to load ${url}`);
        }

        const json = await response.json();
        if (active) {
          setState({ data: normalizeData(json), error: null, loading: false });
        }
      } catch (error) {
        if (active) {
          setState({ data: null, error, loading: false });
        }
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [url]);

  return state;
}

function useText(url) {
  const [state, setState] = useState({ data: "", error: null, loading: true });

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to load ${url}`);
        }

        const text = await response.text();
        if (active) {
          setState({ data: fixText(text), error: null, loading: false });
        }
      } catch (error) {
        if (active) {
          setState({ data: "", error, loading: false });
        }
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [url]);

  return state;
}

function usePageSetup(title, bodyClassName = "") {
  const location = useLocation();

  useEffect(() => {
    document.title = title;
  }, [title]);

  useEffect(() => {
    window.scrollTo(0, 0);
    document.body.className = bodyClassName ? `${bodyClassName} page-ready` : "page-ready";
  }, [bodyClassName, location.pathname, location.search]);
}

function useTransitionNavigate() {
  const navigate = useNavigate();

  return (to) => {
    document.body.classList.remove("menu-open");
    document.body.classList.remove("page-ready");
    document.body.classList.add("page-leaving");

    window.setTimeout(() => {
      navigate(to);
    }, 350);
  };
}

function buildWritingRoute(blogId) {
  return `/writings/${encodeURIComponent(blogId)}`;
}

function buildProjectRoute(repo) {
  const [owner, name] = String(repo || "").split("/");
  if (!owner || !name) {
    return "/project";
  }

  return `/project/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

function normalizePathname(pathname) {
  if (!pathname || pathname === "/") {
    return "/";
  }

  return pathname.replace(/\/+$/, "") || "/";
}

function formatPathLabel(value) {
  return String(value || "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function isNavItemActive(pathname, href) {
  const currentPath = normalizePathname(pathname);
  const targetPath = normalizePathname(href);

  if (targetPath === "/") {
    return currentPath === "/";
  }

  if (targetPath === "/works") {
    return currentPath === "/works" || currentPath.startsWith("/project/") || currentPath === "/production-projects" || currentPath === "/ai-machine-learning" || currentPath === "/train-to-thoughts" || currentPath === "/available-for-freelancing";
  }

  if (targetPath === "/writings") {
    return currentPath === "/writings" || currentPath.startsWith("/writings/");
  }

  return currentPath === targetPath;
}

function getNavStatus(pathname, siteData) {
  const currentPath = normalizePathname(pathname);
  const workPages = siteData?.works?.pages || {};
  const directMatch = siteData?.navigation?.find((item) => normalizePathname(item.href) === currentPath);

  if (directMatch) {
    return {
      eyebrow: "Current page",
      trail: [{ label: formatPathLabel(directMatch.label) }],
    };
  }

  if (currentPath.startsWith("/writings/")) {
    const blogId = decodeURIComponent(currentPath.slice("/writings/".length));
    return {
      eyebrow: "Current page",
      trail: [
        { label: "Writings", href: "/writings" },
        { label: formatPathLabel(blogId) || "Writing" },
      ],
    };
  }

  if (currentPath.startsWith("/project/")) {
    const segments = currentPath.split("/");
    const repo = decodeURIComponent(segments[3] || "");
    return {
      eyebrow: "Current page",
      trail: [
        { label: "Production Projects", href: "/production-projects" },
        { label: formatPathLabel(repo) || "Project" },
      ],
    };
  }

  const workEntry = Object.entries(workPages).find(([slug]) => `/${slug}` === currentPath);
  if (workEntry) {
    return {
      eyebrow: "Current page",
      trail: [
        { label: "Works", href: "/works" },
        { label: workEntry[1]?.title || formatPathLabel(workEntry[0]) },
      ],
    };
  }

  if (currentPath === "/auth") {
    return {
      eyebrow: "Current page",
      trail: [{ label: "Sign Up" }],
    };
  }

  if (currentPath === "/auth/callback") {
    return {
      eyebrow: "Current page",
      trail: [{ label: "Signing In" }],
    };
  }

  if (currentPath === "/account") {
    return {
      eyebrow: "Current page",
      trail: [{ label: "Account" }],
    };
  }

  return null;
}

function slugifyValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function canManageContent(auth, scope = "writings") {
  const role = String(auth?.profile?.role || "").trim().toLowerCase();
  if (role === "admin") {
    return true;
  }
  if (role === "member") {
    return scope === "writings" || scope === "projects";
  }
  return false;
}

function useManagedContent() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const nextItems = await fetchPublicContent();
        if (!active) {
          return;
        }
        setItems(Array.isArray(nextItems) ? nextItems : []);
        setError(null);
      } catch (loadError) {
        if (!active) {
          return;
        }
        setError(loadError);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      active = false;
    };
  }, []);

  async function refresh() {
    const nextItems = await fetchPublicContent();
    setItems(Array.isArray(nextItems) ? nextItems : []);
    setError(null);
    return nextItems;
  }

  return {
    items,
    loading,
    error,
    refresh,
  };
}

function getApprovedContentByType(content, contentType) {
  return (content?.items || []).filter((item) => item.contentType === contentType);
}

function getLatestMatchingContent(items, predicate) {
  return [...items].filter(predicate).sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))[0] || null;
}

function mergeBlogPosts(staticPosts, content) {
  const approvedBlogs = getApprovedContentByType(content, "blog");
  const merged = Array.isArray(staticPosts) ? [...staticPosts] : [];

  for (const entry of approvedBlogs) {
    const index = merged.findIndex((item) => slugifyValue(item.id) === entry.targetSlug || slugifyValue(item.title) === entry.targetSlug);
    const mapped = mapContentItemToBlog(entry);
    if (index >= 0) {
      merged[index] = {
        ...merged[index],
        ...mapped,
      };
    } else {
      merged.push(mapped);
    }
  }

  return merged;
}

function mapContentItemToBlog(item) {
  return {
    id: item.targetSlug,
    title: item.title,
    description: item.description,
    image: item.heroImage || "/featuredimages/1.jpg",
    author: item.authorName || "Member",
    date: formatShortDate(item.updatedAt || item.createdAt),
    readTime: item.readTime || "4 min read",
    views: 0,
    comments: 0,
    likes: 0,
    category: item.category || (item.authorRole === "admin" ? "Admin" : "Member"),
    authorRole: item.authorRole || "member",
    markdown: item.markdown,
    _managedContentId: item.id,
  };
}

function resolveBlogManagedEntry(blogId, content) {
  return getLatestMatchingContent(getApprovedContentByType(content, "blog"), (item) => item.targetSlug === slugifyValue(blogId));
}

function resolvePageManagedEntry(section, slug, content) {
  return getLatestMatchingContent(getApprovedContentByType(content, "page"), (item) => item.section === section && item.targetSlug === slugifyValue(slug));
}

function mergeProjects(staticProjects, content) {
  const approvedProjects = getApprovedContentByType(content, "project");
  const merged = Array.isArray(staticProjects) ? [...staticProjects] : [];

  for (const entry of approvedProjects) {
    const mapped = mapContentItemToProject(entry);
    const index = merged.findIndex((item) => slugifyValue(item.id) === entry.targetSlug || slugifyValue(item.title) === entry.targetSlug);
    if (index >= 0) {
      merged[index] = {
        ...merged[index],
        ...mapped,
      };
    } else {
      merged.push(mapped);
    }
  }

  return merged;
}

function mapContentItemToProject(item) {
  return {
    id: item.targetSlug,
    title: item.title,
    heroTitle: item.title,
    description: item.description,
    image: item.heroImage || "/featuredimages/1.jpg",
    meta: item.meta || "Managed Project",
    category: item.category || "",
    authorRole: item.authorRole || "member",
    github: item.githubUrl || "",
    docFile: "",
    docsMarkdown: item.markdown,
    _managedContentId: item.id,
  };
}

function formatShortDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Jul 26, 2026";
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function deriveDashboardCounts(data) {
  return {
    roleRequests: Array.isArray(data?.roleRequests) ? data.roleRequests.length : 0,
    comments: Array.isArray(data?.comments) ? data.comments.filter((item) => item.status === "pending").length : 0,
    content: Array.isArray(data?.contentRequests) ? data.contentRequests.length : 0,
  };
}

function normalizeAuthError(error, context = {}) {
  const fallback = "We couldn't complete authentication. Please try again.";
  const sourceMessage = String(
    error?.message ||
      error?.error_description ||
      error?.description ||
      error?.error ||
      ""
  ).trim();
  const raw = sourceMessage.toLowerCase();

  if (!sourceMessage) {
    return fallback;
  }

  if (raw.includes("invalid login credentials")) {
    return "That email or password did not match. Please check your details and try again.";
  }

  if (raw.includes("email not confirmed")) {
    return "Your email is not confirmed yet. Open the confirmation link from your inbox, then sign in again.";
  }

  if (raw.includes("password should be at least")) {
    return "Use a stronger password with at least 8 characters.";
  }

  if (raw.includes("user already registered")) {
    return "An account with this email already exists. Try logging in instead.";
  }

  if (raw.includes("signup is disabled")) {
    return "New account creation is disabled right now.";
  }

  if (raw.includes("provider is not enabled")) {
    return `The ${context.provider || "selected"} sign-in option is not enabled yet.`;
  }

  if (raw.includes("unsupported provider")) {
    return `The ${context.provider || "selected"} sign-in option is not supported yet.`;
  }

  if (raw.includes("access_denied")) {
    return `Access was denied by ${context.provider || "the provider"}. If this is Google, add your email as a test user or publish the OAuth consent screen first.`;
  }

  if (raw.includes("oauth") && raw.includes("redirect")) {
    return "The sign-in callback URL does not match your provider setup. Check the Supabase redirect URLs and provider callback settings.";
  }

  if (raw.includes("code verifier") || raw.includes("code challenge")) {
    return "This sign-in attempt expired before it finished. Please start the sign-in flow again.";
  }

  if (raw.includes("failed to fetch") || raw.includes("networkerror")) {
    return "A network issue interrupted sign-in. Check your connection and try again.";
  }

  return sourceMessage;
}

function getAuthCallbackErrorFromUrl() {
  if (typeof window === "undefined") {
    return null;
  }

  const url = new URL(window.location.href);
  const searchParams = url.searchParams;
  const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const errorCode = searchParams.get("error") || hashParams.get("error") || "";
  const errorDescription =
    searchParams.get("error_description") ||
    hashParams.get("error_description") ||
    searchParams.get("error_code") ||
    "";

  if (!errorCode && !errorDescription) {
    return null;
  }

  return {
    error: errorCode,
    error_description: errorDescription,
  };
}

function clearAuthCallbackArtifacts() {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);
  const authKeys = [
    "code",
    "error",
    "error_code",
    "error_description",
    "provider_token",
    "provider_refresh_token",
    "refresh_token",
    "access_token",
    "token_type",
    "type",
  ];

  authKeys.forEach((key) => {
    url.searchParams.delete(key);
  });

  if (url.hash) {
    const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
    authKeys.forEach((key) => {
      hashParams.delete(key);
    });
    const nextHash = hashParams.toString();
    url.hash = nextHash ? `#${nextHash}` : "";
  }

  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

function getDisplayNameFromProfile(profile, user) {
  return String(profile?.displayName || user?.email || "Member").trim();
}

function getAvatarFallback(profile, user) {
  const label = getDisplayNameFromProfile(profile, user);
  return String(label)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "M";
}

function getAvatarUrl(profile) {
  return String(profile?.avatarUrl || "").trim();
}

function useSupabaseAuth() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [promptMessage, setPromptMessage] = useState("");
  const [callbackReady, setCallbackReady] = useState(false);
  const [configured, setConfigured] = useState(
    Boolean(resolveSupabaseUrl() && resolveSupabasePublishableKey())
  );

  useEffect(() => {
    let active = true;
    let subscription;

    async function initialize() {
      try {
        try {
          await loadSupabaseRuntimeConfig();
        } catch (configError) {
          console.warn("[auth-ui] runtime config load failed", configError);
        }

        const hasConfig = Boolean(resolveSupabaseUrl() && resolveSupabasePublishableKey());
        if (!active) {
          return;
        }

        setConfigured(hasConfig);

        if (!hasConfig) {
          setSession(null);
          setProfile(null);
          setLoading(false);
          setCallbackReady(true);
          return;
        }

        const supabase = getSupabaseClient();
        const callbackError = getAuthCallbackErrorFromUrl();
        if (callbackError && active) {
          setError(normalizeAuthError(callbackError));
          clearPendingRequestedRole();
          clearAuthCallbackArtifacts();
        }

        const authSubscription = supabase.auth.onAuthStateChange(async (event, nextSession) => {
          console.log("[auth-ui] state change", { event });
          setSession(nextSession);

          if (!nextSession?.user) {
            setProfile(null);
            if (event === "SIGNED_OUT") {
              setNotice("You have been signed out.");
            }
            return;
          }

          try {
            const nextProfile = await syncProfile(nextSession.user);
            if (active) {
              setProfile(nextProfile);
              if (event === "SIGNED_IN") {
                setNotice("You are now signed in.");
                clearPendingRequestedRole();
              }
            }
          } catch (profileError) {
            if (active) {
              setError(normalizeAuthError(profileError));
            }
          }
        });
        subscription = authSubscription.data.subscription;

        const url = new URL(window.location.href);
        if (url.pathname === "/auth/callback" && url.searchParams.get("code")) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(url.href);
          if (exchangeError) {
            throw exchangeError;
          }
          if (active) {
            clearAuthCallbackArtifacts();
          }
        }

        const {
          data: { session: initialSession },
        } = await supabase.auth.getSession();

        if (!active) {
          return;
        }

        setSession(initialSession);
        if (initialSession?.user) {
          const nextProfile = await syncProfile(initialSession.user);
          if (active) {
            setProfile(nextProfile);
          }
        } else {
          setProfile(null);
        }
      } catch (authError) {
        if (active) {
          setError(normalizeAuthError(authError));
        }
      } finally {
        if (active) {
          setLoading(false);
          setCallbackReady(true);
        }
      }
    }

    initialize();

    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, []);

  async function syncProfile(user, overrides = {}) {
    const requestedRole = overrides.requestedRole || getPendingRequestedRole() || user?.user_metadata?.requested_role || "visitor";
    const displayName =
      overrides.displayName ||
      user?.user_metadata?.display_name ||
      user?.user_metadata?.full_name ||
      user?.user_metadata?.name ||
      (user?.email ? String(user.email).split("@")[0] : "Member");

    const profileData = await saveAccountProfile({
      displayName,
      requestedRole,
      newsletterSubscribed: true,
    });
    return profileData;
  }

  async function signUpWithEmail({ displayName, email, password, requestedRole }) {
    if (!configured) {
      throw new Error("Supabase auth is not configured yet.");
    }

    const supabase = getSupabaseClient();
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const normalizedDisplayName = String(displayName || "").trim();
      const normalizedEmail = String(email || "").trim().toLowerCase();
      const normalizedPassword = String(password || "");

      if (!normalizedDisplayName) {
        throw new Error("Please add a display name.");
      }

      if (normalizedPassword.length < 8) {
        throw new Error("Use a stronger password with at least 8 characters.");
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: normalizedEmail,
        password: normalizedPassword,
        options: {
          emailRedirectTo: getAuthRedirectUrl(),
          data: {
            display_name: normalizedDisplayName,
            requested_role: requestedRole,
          },
        },
      });

      if (signUpError) {
        throw signUpError;
      }

      setPendingRequestedRole(requestedRole);

      if (data.session?.user) {
        const nextProfile = await syncProfile(data.session.user, {
          displayName: normalizedDisplayName,
          requestedRole,
        });
        setProfile(nextProfile);
        setSession(data.session);
        setNotice("Account created successfully.");
      } else {
        setNotice("Account created. Check your email to confirm the signup link.");
      }
    } catch (authError) {
      console.error("[auth-ui] signUpWithEmail failed", authError);
      setError(normalizeAuthError(authError));
      throw authError;
    } finally {
      setBusy(false);
    }
  }

  async function signInWithEmail({ email, password }) {
    if (!configured) {
      throw new Error("Supabase auth is not configured yet.");
    }

    const supabase = getSupabaseClient();
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const normalizedEmail = String(email || "").trim().toLowerCase();
      const normalizedPassword = String(password || "");

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: normalizedPassword,
      });

      if (signInError) {
        throw signInError;
      }

      if (data.session?.user) {
        const nextProfile = await syncProfile(data.session.user);
        setProfile(nextProfile);
        setSession(data.session);
      }
      setNotice("Signed in successfully.");
    } catch (authError) {
      console.error("[auth-ui] signInWithEmail failed", authError);
      setError(normalizeAuthError(authError));
      throw authError;
    } finally {
      setBusy(false);
    }
  }

  async function signInWithProvider(provider, requestedRole) {
    if (!configured) {
      throw new Error("Supabase auth is not configured yet.");
    }

    const supabase = getSupabaseClient();
    setBusy(true);
    setError("");
    setNotice("");

    try {
      setPendingRequestedRole(requestedRole);
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: getAuthRedirectUrl(),
          queryParams: provider === "google" ? { prompt: "select_account" } : undefined,
        },
      });

      if (oauthError) {
        throw oauthError;
      }
    } catch (authError) {
      console.error("[auth-ui] signInWithProvider failed", { provider, error: authError });
      setError(normalizeAuthError(authError, { provider }));
      clearPendingRequestedRole();
      throw authError;
    } finally {
      setBusy(false);
    }
  }

  async function signOutUser() {
    if (!configured) {
      return;
    }

    const supabase = getSupabaseClient();
    setBusy(true);
    setError("");

    try {
      const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
      if (signOutError) {
        throw signOutError;
      }
      clearPendingRequestedRole();
    } catch (authError) {
      console.error("[auth-ui] signOut failed", authError);
      setError(normalizeAuthError(authError));
      throw authError;
    } finally {
      setBusy(false);
    }
  }

  async function updateProfile(updates = {}) {
    if (!session?.user) {
      throw new Error("Please sign in to update your profile.");
    }

    const payload = {
      displayName: String(
        updates.displayName || profile?.displayName || session.user.email || "Member"
      ).trim(),
      avatarUrl: String(updates.avatarUrl || "").trim(),
      requestedRole: profile?.requestedRole || getPendingRequestedRole() || "visitor",
      newsletterSubscribed:
        typeof profile?.newsletterSubscribed === "boolean" ? profile.newsletterSubscribed : true,
    };

    const nextProfile = await saveAccountProfile(payload);
    setProfile(nextProfile);
    setNotice("Profile updated.");
    setError("");
    return nextProfile;
  }

  async function uploadProfileAvatar(file) {
    if (!session?.user) {
      throw new Error("Please sign in to upload a profile picture.");
    }

    if (!file) {
      throw new Error("Choose an image before uploading.");
    }

    if (!String(file.type || "").startsWith("image/")) {
      throw new Error("Profile pictures must be image files.");
    }

    if (Number(file.size || 0) > 4 * 1024 * 1024) {
      throw new Error("Profile pictures must be 4 MB or smaller.");
    }

    const supabase = getSupabaseClient();
    const bucket = resolveAvatarBucketName();
    const extension = String(file.name || "avatar.png").split(".").pop()?.toLowerCase() || "png";
    const safeExtension = extension.replace(/[^a-z0-9]/gi, "") || "png";
    const filePath = `${session.user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExtension}`;

    const { error: uploadError } = await supabase.storage.from(bucket).upload(filePath, file, {
      cacheControl: "3600",
      upsert: true,
    });

    if (uploadError) {
      throw new Error(
        "Could not upload the profile picture. Make sure the Supabase Storage bucket exists and allows authenticated uploads."
      );
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from(bucket).getPublicUrl(filePath);

    if (!publicUrl) {
      throw new Error("The profile picture uploaded, but its public URL could not be created.");
    }

    return publicUrl;
  }

  function openAuthPrompt(message) {
    setPromptMessage(message || "Please sign in to continue.");
  }

  function closeAuthPrompt() {
    setPromptMessage("");
  }

  return {
    configured,
    loading,
    busy,
    error,
    notice,
    promptMessage,
    callbackReady,
    session,
    user: session?.user || null,
    profile,
    setError,
    setNotice,
    openAuthPrompt,
    closeAuthPrompt,
    signUpWithEmail,
    signInWithEmail,
    signInWithProvider,
    signOutUser,
    updateProfile,
    uploadProfileAvatar,
    refreshProfile: async () => {
      if (!session?.user) {
        return null;
      }
      const nextProfile = await fetchAccountProfile();
      setProfile(nextProfile);
      return nextProfile;
    },
  };
}

function useEngagement(auth) {
  const [statsMap, setStatsMap] = useState({});
  const [profile, setProfile] = useState(() => loadStoredProfile());
  const [error, setError] = useState("");
  const [storage, setStorage] = useState("file");
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");
  const requestRef = useRef(0);

  useEffect(() => {
    persistProfile(profile);
  }, [profile]);

  useEffect(() => {
    let active = true;
    const syncIntervalMs = 4000;

    async function sync({ silent = false } = {}) {
      const requestId = requestRef.current + 1;
      requestRef.current = requestId;

      try {
        const response = await fetchEngagementStats();
        if (!active || requestRef.current !== requestId) {
          return response;
        }

        setStatsMap(response.stats);
        setStorage(response.storage);
        setLastUpdatedAt(response.updatedAt);
        setError("");
        return response;
      } catch (loadError) {
        if (!active || requestRef.current !== requestId) {
          return null;
        }

        if (!silent) {
          setError(loadError.message);
        }
        return null;
      }
    }

    sync();

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        sync({ silent: true });
      }
    }, syncIntervalMs);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        sync({ silent: true });
      }
    };

    const handleFocus = () => {
      sync({ silent: true });
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  function saveProfile(updates) {
    setProfile((current) => ({
      actorId: auth.user?.id || current.actorId || createActorId(),
      name: updates.name ?? auth.profile?.displayName ?? current.name ?? "",
      email: updates.email ?? auth.user?.email ?? current.email ?? "",
    }));
  }

  async function refresh() {
    try {
      const response = await fetchEngagementStats();
      setStatsMap(response.stats);
      setStorage(response.storage);
      setLastUpdatedAt(response.updatedAt);
      setError("");
      return response.stats;
    } catch (loadError) {
      const message = buildEngagementErrorMessage(loadError);
      console.error("[engagement-ui] refresh failed", {
        message,
        requestId: loadError?.requestId || "",
      });
      setError(message);
      throw loadError;
    }
  }

  async function handleToggleLike({ entityType, entityId, actorName }) {
    if (!auth.user) {
      auth.openAuthPrompt("Sign in to like posts, articles, and projects.");
      throw new Error("Please sign in to like this content.");
    }

    const nextProfile = {
      actorId: auth.user.id,
      name: actorName || auth.profile?.displayName || profile.name || "Member",
      email: auth.user.email || profile.email,
    };
    setProfile(nextProfile);
    setError("");

    const previousStatsMap = statsMap;
    const optimisticStatsMap = applyOptimisticLikeToggle(statsMap, entityType, entityId, {
      actorId: nextProfile.actorId,
      actorName: nextProfile.name,
    });
    setStatsMap(optimisticStatsMap);

    try {
      const response = await toggleLike({
        entityType,
        entityId,
        actorId: nextProfile.actorId,
        actorName: nextProfile.name,
      });
      setStatsMap(response.stats);
      setStorage(response.storage);
      setLastUpdatedAt(response.updatedAt);
      return response.stats[entityKey(entityType, entityId)] || null;
    } catch (toggleError) {
      setStatsMap(previousStatsMap);
      const message = buildEngagementErrorMessage(toggleError);
      console.error("[engagement-ui] toggle like failed", {
        entityType,
        entityId,
        message,
        requestId: toggleError?.requestId || "",
      });
      setError(message);
      throw toggleError;
    }
  }

  async function handleCreateComment({ entityType, entityId, authorName, authorEmail, message }) {
    if (!auth.user) {
      auth.openAuthPrompt("Sign in to post comments and keep them attached to your account.");
      throw new Error("Please sign in to comment.");
    }

    const nextProfile = {
      actorId: auth.user.id,
      name: authorName || auth.profile?.displayName || profile.name,
      email: auth.user.email || authorEmail || profile.email,
    };
    setProfile(nextProfile);

    try {
      const response = await createComment({
        entityType,
        entityId,
        actorId: nextProfile.actorId,
        authorName: nextProfile.name,
        authorEmail: nextProfile.email,
        message,
      });
      setStatsMap(response.stats);
      setStorage(response.storage);
      setLastUpdatedAt(response.updatedAt);
      setError("");
      return response.stats[entityKey(entityType, entityId)] || null;
    } catch (commentError) {
      const message = buildEngagementErrorMessage(commentError);
      console.error("[engagement-ui] comment failed", {
        entityType,
        entityId,
        message,
        requestId: commentError?.requestId || "",
      });
      setError(message);
      throw commentError;
    }
  }

  async function handleDeleteComment({ entityType, entityId, commentId }) {
    if (!auth.user) {
      auth.openAuthPrompt("Sign in to manage your comments.");
      throw new Error("Please sign in to delete your comment.");
    }

    try {
      const response = await deleteComment({
        entityType,
        entityId,
        commentId,
      });
      setStatsMap(response.stats);
      setStorage(response.storage);
      setLastUpdatedAt(response.updatedAt);
      setError("");
      return response.stats[entityKey(entityType, entityId)] || null;
    } catch (deleteError) {
      const message = buildEngagementErrorMessage(deleteError);
      console.error("[engagement-ui] delete comment failed", {
        entityType,
        entityId,
        commentId,
        message,
        requestId: deleteError?.requestId || "",
      });
      setError(message);
      throw deleteError;
    }
  }

  async function handleIncrementView({ entityType, entityId }) {
    try {
      const response = await incrementView({
        entityType,
        entityId,
      });
      setStatsMap(response.stats);
      setStorage(response.storage);
      setLastUpdatedAt(response.updatedAt);
      setError("");
      return response.stats[entityKey(entityType, entityId)] || null;
    } catch (viewError) {
      const message = buildEngagementErrorMessage(viewError);
      console.error("[engagement-ui] increment view failed", {
        entityType,
        entityId,
        message,
        requestId: viewError?.requestId || "",
      });
      setError(message);
      throw viewError;
    }
  }

  return {
    statsMap,
    profile: {
      actorId: auth.user?.id || profile.actorId,
      name: auth.profile?.displayName || profile.name,
      email: auth.user?.email || profile.email,
    },
    auth,
    error,
    storage,
    lastUpdatedAt,
    saveProfile,
    refresh,
    toggleLike: handleToggleLike,
    createComment: handleCreateComment,
    deleteComment: handleDeleteComment,
    incrementView: handleIncrementView,
  };
}

function describeEngagementStorage(storage) {
  if (storage === "database") {
    return "Likes and comments are synced through Supabase or another Postgres database.";
  }
  if (storage === "blob") {
    return "Likes and comments are shared through Vercel Blob storage.";
  }
  return "Likes and comments are stored locally in the development JSON dataset.";
}

function buildEngagementErrorMessage(error) {
  const baseMessage = error?.message || "Something went wrong while syncing engagement.";
  const requestId = String(error?.requestId || "").trim();
  if (!requestId) {
    return baseMessage;
  }
  return `${baseMessage} Reference: ${requestId}`;
}

function loadStoredProfile() {
  if (typeof window === "undefined") {
    return { actorId: "", name: "", email: "" };
  }

  try {
    const raw = window.localStorage.getItem("dexteritycoder-profile");
    if (!raw) {
      return { actorId: createActorId(), name: "", email: "" };
    }

    const parsed = JSON.parse(raw);
    return {
      actorId: parsed.actorId || createActorId(),
      name: parsed.name || "",
      email: parsed.email || "",
    };
  } catch {
    return { actorId: createActorId(), name: "", email: "" };
  }
}

function persistProfile(profile) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem("dexteritycoder-profile", JSON.stringify(profile));
}

function createActorId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `guest-${Math.random().toString(36).slice(2, 12)}`;
}

function TransitionLink({ href, className, children, style, ...rest }) {
  const navigateWithTransition = useTransitionNavigate();
  const externalOnClick = rest.onClick;

  function handleClick(event) {
    if (typeof externalOnClick === "function") {
      externalOnClick(event);
    }

    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      rest.target === "_blank" ||
      !href.startsWith("/")
    ) {
      return;
    }

    event.preventDefault();
    navigateWithTransition(href);
  }

  const linkProps = { ...rest };
  delete linkProps.onClick;

  return (
    <a {...linkProps} href={href} className={className} style={style} onClick={handleClick}>
      {children}
    </a>
  );
}

function EngagementPanel({ entityType, entityId, engagement, title = "Comments & Likes" }) {
  const stats = getEntityStats(engagement.statsMap, entityType, entityId);
  const viewerHasLiked = stats.likedBy.some((entry) => entry.actorId === engagement.profile.actorId);
  const signedIn = Boolean(engagement.auth?.user);
  const [authorName, setAuthorName] = useState(engagement.profile.name || "");
  const [authorEmail, setAuthorEmail] = useState(engagement.profile.email || "");
  const [message, setMessage] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyCommentId, setBusyCommentId] = useState("");

  useEffect(() => {
    setAuthorName(engagement.profile.name || "");
    setAuthorEmail(engagement.profile.email || "");
  }, [engagement.profile.email, engagement.profile.name]);

  async function handleLikeClick() {
    if (!signedIn) {
      engagement.auth.openAuthPrompt("Sign in to like posts, articles, and projects.");
      setActionError("Please sign in to like this content.");
      return;
    }

    const trimmedName = authorName.trim() || engagement.profile.name.trim();
    if (!trimmedName) {
      setActionError("Enter your name before liking this post.");
      return;
    }

    setBusyAction("like");
    setActionError("");

    try {
      engagement.saveProfile({ name: trimmedName, email: authorEmail.trim() });
      await engagement.toggleLike({
        entityType,
        entityId,
        actorName: trimmedName,
      });
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusyAction("");
    }
  }

  async function handleDeleteCommentClick(commentId) {
    setBusyCommentId(commentId);
    setActionError("");

    try {
      await engagement.deleteComment({
        entityType,
        entityId,
        commentId,
      });
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusyCommentId("");
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const trimmedName = authorName.trim();
    const trimmedMessage = message.trim();
    if (!trimmedName || !trimmedMessage) {
      setActionError("Name and comment are both required.");
      return;
    }

    setBusyAction("comment");
    setActionError("");

    try {
      engagement.saveProfile({ name: trimmedName, email: authorEmail.trim() });
      await engagement.createComment({
        entityType,
        entityId,
        authorName: trimmedName,
        authorEmail: authorEmail.trim(),
        message: trimmedMessage,
      });
      setMessage("");
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusyAction("");
    }
  }

  return (
    <section className="engagement-panel">
      <div className="engagement-header">
        <div>
          <h2>{title}</h2>
          <p>{describeEngagementStorage(engagement.storage)}</p>
        </div>
        <button
          type="button"
          className={`engagement-like-btn${viewerHasLiked ? " is-active" : ""}`}
          onClick={handleLikeClick}
          disabled={busyAction === "like"}
        >
          {viewerHasLiked ? "Unlike" : "Like"} · {formatCount(stats.likeCount)}
        </button>
      </div>

      <div className="engagement-stats-row">
        <span>{formatCount(stats.commentCount)} comments</span>
        <span>{formatCount(stats.likeCount)} likes</span>
        <span>{stats.likedBy.length > 0 ? `Recent likes: ${stats.likedBy.slice(0, 3).map((entry) => entry.actorName).join(", ")}` : "Be the first recent like."}</span>
      </div>

      {actionError ? <p className="engagement-error">{actionError}</p> : null}
      {engagement.error ? <p className="engagement-error">{engagement.error}</p> : null}

      <form className="engagement-form" onSubmit={handleSubmit}>
        {signedIn ? (
          <p className="engagement-auth-note">Signed in as {engagement.profile.name || engagement.auth.user.email}</p>
        ) : (
          <div className="engagement-form-grid">
            <input
              type="text"
              placeholder="Your name"
              value={authorName}
              onChange={(event) => setAuthorName(event.target.value)}
              maxLength={80}
              required
            />
            <input
              type="email"
              placeholder="Email (optional)"
              value={authorEmail}
              onChange={(event) => setAuthorEmail(event.target.value)}
              maxLength={160}
            />
          </div>
        )}
        <textarea
          placeholder={signedIn ? "Write your comment here..." : "Sign in to write a comment..."}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows="5"
          maxLength={2000}
          required
          disabled={!signedIn}
        ></textarea>
        <button type="submit" className="engagement-submit-btn" disabled={busyAction === "comment" || !signedIn}>
          {busyAction === "comment" ? "Posting..." : "Post Comment"}
        </button>
        {!signedIn ? (
          <button type="button" className="engagement-submit-btn" onClick={() => engagement.auth.openAuthPrompt("Sign in to comment and keep your activity saved to your account.")}>
            Sign Up / Log In
          </button>
        ) : null}
      </form>

      <div className="engagement-comments">
        {stats.comments.length === 0 ? (
          <p className="engagement-empty-state">No recent comments yet. Start the conversation.</p>
        ) : (
          stats.comments.map((comment) => (
            <article key={comment.id} className="engagement-comment-card">
              <div className="engagement-comment-meta">
                <div className="engagement-comment-meta-main">
                  <strong>{comment.authorName}</strong>
                  <span>{formatCommentDate(comment.createdAt)}</span>
                </div>
                  <button
                    type="button"
                    className="engagement-comment-remove-btn"
                    onClick={() => handleDeleteCommentClick(comment.id)}
                    disabled={busyCommentId === comment.id}
                    hidden={comment.actorId !== engagement.auth?.user?.id}
                  >
                    {busyCommentId === comment.id ? "Removing..." : "Remove"}
                  </button>
              </div>
              <p>{comment.message}</p>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function LikeButton({ entityType, entityId, engagement, className = "", showCount = true }) {
  const stats = getEntityStats(engagement.statsMap, entityType, entityId);
  const viewerHasLiked = stats.likedBy.some((entry) => entry.actorId === engagement.profile.actorId);
  const [busy, setBusy] = useState(false);
  const [isPopping, setIsPopping] = useState(false);

  async function handleClick(event) {
    event.preventDefault();
    event.stopPropagation();
    if (busy) {
      return;
    }

    const willLike = !viewerHasLiked;
    setBusy(true);

    try {
      if (willLike) {
        setIsPopping(false);
        window.setTimeout(() => {
          setIsPopping(true);
          window.setTimeout(() => setIsPopping(false), 280);
        }, 0);
      }
      await engagement.toggleLike({
        entityType,
        entityId,
        actorName: engagement.profile.name || "Guest",
      });
    } catch (error) {
      console.error("[engagement-ui] like button failed", {
        entityType,
        entityId,
        message: error?.message || "",
        requestId: error?.requestId || "",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={`like-button${viewerHasLiked ? " is-active" : ""}${isPopping ? " is-popping" : ""}${busy ? " is-busy" : ""}${className ? ` ${className}` : ""}`}
      onClick={handleClick}
      aria-label={viewerHasLiked ? "Unlike" : "Like"}
      aria-pressed={viewerHasLiked}
    >
      <span className="like-button-heart">{viewerHasLiked ? "♥" : "♡"}</span>
      {showCount ? <span className="like-button-count">{formatCount(stats.likeCount)}</span> : null}
    </button>
  );
}

function applyOptimisticLikeToggle(currentStatsMap, entityType, entityId, actor) {
  const key = entityKey(entityType, entityId);
  const currentStats = getEntityStats(currentStatsMap, entityType, entityId);
  const likedBy = Array.isArray(currentStats.likedBy) ? [...currentStats.likedBy] : [];
  const existingIndex = likedBy.findIndex((entry) => entry.actorId === actor.actorId);
  const isCurrentlyLiked = existingIndex >= 0;

  if (isCurrentlyLiked) {
    likedBy.splice(existingIndex, 1);
  } else {
    likedBy.unshift({
      actorId: actor.actorId,
      actorName: actor.actorName,
      createdAt: new Date().toISOString(),
    });
  }

  return {
    ...currentStatsMap,
    [key]: {
      commentCount: Number(currentStats.commentCount || 0),
      likeCount: Math.max(0, Number(currentStats.likeCount || 0) + (isCurrentlyLiked ? -1 : 1)),
      comments: Array.isArray(currentStats.comments) ? [...currentStats.comments] : [],
      likedBy,
    },
  };
}

function CommentsPanel({ entityType, entityId, engagement, title = "Comments" }) {
  const stats = getEntityStats(engagement.statsMap, entityType, entityId);
  const signedIn = Boolean(engagement.auth?.user);
  const [authorName, setAuthorName] = useState(engagement.profile.name || "");
  const [message, setMessage] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyCommentId, setBusyCommentId] = useState("");

  useEffect(() => {
    setAuthorName(engagement.profile.name || "");
  }, [engagement.profile.name]);

  async function handleSubmit(event) {
    event.preventDefault();

    const trimmedName = authorName.trim();
    const trimmedMessage = message.trim();
    if (!trimmedName || !trimmedMessage) {
      setActionError("Name and comment are both required.");
      return;
    }

    setBusyAction("comment");
    setActionError("");

    try {
      engagement.saveProfile({ name: trimmedName });
      await engagement.createComment({
        entityType,
        entityId,
        authorName: trimmedName,
        authorEmail: "",
        message: trimmedMessage,
      });
      setMessage("");
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusyAction("");
    }
  }

  async function handleDeleteCommentClick(commentId) {
    setBusyCommentId(commentId);
    setActionError("");

    try {
      await engagement.deleteComment({
        entityType,
        entityId,
        commentId,
      });
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusyCommentId("");
    }
  }

  return (
    <section className="engagement-stack">
      <div className="engagement-panel engagement-panel-minimal">
        <div className="engagement-header">
          <h2>{title}</h2>
          <span className="engagement-count">{formatCount(stats.commentCount)} comments</span>
        </div>

        {actionError ? <p className="engagement-error">{actionError}</p> : null}
        {engagement.error ? <p className="engagement-error">{engagement.error}</p> : null}

        <form className="engagement-form" onSubmit={handleSubmit}>
          <div className="engagement-form-top">
            {!signedIn ? (
              <input
                type="text"
                placeholder="Your name"
                value={authorName}
                onChange={(event) => setAuthorName(event.target.value)}
                maxLength={80}
                required
              />
            ) : (
              <p className="engagement-auth-note">Signed in as {engagement.profile.name || engagement.auth.user.email}</p>
            )}
            <button type="submit" className="engagement-submit-btn" disabled={busyAction === "comment" || !signedIn}>
              {busyAction === "comment" ? "Posting..." : "Comment"}
            </button>
          </div>
          <textarea
            placeholder={signedIn ? "Write a comment..." : "Sign in to write a comment..."}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows="3"
            maxLength={2000}
            required
            disabled={!signedIn}
          ></textarea>
          {!signedIn ? (
            <button type="button" className="engagement-submit-btn" onClick={() => engagement.auth.openAuthPrompt("Sign in to comment and keep your activity saved to your account.")}>
              Sign Up / Log In
            </button>
          ) : null}
        </form>
      </div>

      <section className="engagement-comments-section" aria-label={`Existing ${title.toLowerCase()}`}>
        <div className="engagement-comments-section-header">
          <h3>Existing Comments</h3>
          <span className="engagement-count">{formatCount(stats.commentCount)} total</span>
        </div>
        <div className="engagement-comments">
          {stats.comments.length === 0 ? (
            <p className="engagement-empty-state">No comments yet.</p>
          ) : (
            stats.comments.map((comment) => (
              <article key={comment.id} className="engagement-comment-card">
                <div className="engagement-comment-meta">
                  <div className="engagement-comment-meta-main">
                    <strong>{comment.authorName}</strong>
                    <span>{formatCommentDate(comment.createdAt)}</span>
                  </div>
                  <button
                    type="button"
                    className="engagement-comment-remove-btn"
                    onClick={() => handleDeleteCommentClick(comment.id)}
                    disabled={busyCommentId === comment.id}
                    hidden={comment.actorId !== engagement.auth?.user?.id}
                  >
                    {busyCommentId === comment.id ? "Removing..." : "Remove"}
                  </button>
                </div>
                <p>{comment.message}</p>
              </article>
            ))
          )}
        </div>
      </section>
    </section>
  );
}

function SocialFooter({ footer }) {
  return (
    <section className="whole_footer">
      <footer>
        <div className="social-icons">
          {footer.socials.map((social) => (
            <a
              key={social.label}
              href={social.href}
              aria-label={social.label}
              target="_blank"
              rel="noreferrer"
            >
              <img src={social.icon} alt="" />
            </a>
          ))}
        </div>
        <hr className="footer_hr" />
        <div className="newsletter">
          <h1>{footer.brand}</h1>
          <form action="#">
            <p>{footer.newsletterPrompt}</p>
            <input type="email" required />
            <div className="newsletter-check">
              <input type="checkbox" id="subscribe" />
              <label htmlFor="subscribe">{footer.newsletterCheckbox}</label>
            </div>
            <button type="submit">{footer.newsletterButton}</button>
          </form>
        </div>
        <hr className="footer_hr" />
        <div className="copyright">
          <p>{footer.copyright}</p>
        </div>
      </footer>
    </section>
  );
}

function MinimalFooter({ footer }) {
  return (
    <footer>
      <div className="copyright">
        <p>{footer.copyright}</p>
      </div>
    </footer>
  );
}

function Navbar({ siteData, auth }) {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [profileDraftName, setProfileDraftName] = useState("");
  const [profileDraftAvatar, setProfileDraftAvatar] = useState("");
  const [profileDraftFile, setProfileDraftFile] = useState(null);
  const [profilePreviewUrl, setProfilePreviewUrl] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState("");
  const fileInputRef = useRef(null);
  const navigateWithTransition = useTransitionNavigate();
  const navStatus = getNavStatus(location.pathname, siteData);
  const navItems = siteData.navigation.map((item) => ({
    ...item,
    icon: getNavItemIcon(item.href),
    active: isNavItemActive(location.pathname, item.href),
  }));

  useEffect(() => {
    function handleEscape(event) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setProfileMenuOpen(false);
      }
    }

    function handleOutsideClick(event) {
      const nav = document.getElementById("rightnav");
      const trigger = document.querySelector(".ham");

      if (!menuOpen || !nav || !trigger) {
        if (!profileMenuOpen) {
          return;
        }
      }

      if (!nav.contains(event.target) && !trigger.contains(event.target)) {
        setMenuOpen(false);
        setProfileMenuOpen(false);
      }
    }

    document.addEventListener("keydown", handleEscape);
    document.addEventListener("click", handleOutsideClick);
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.removeEventListener("click", handleOutsideClick);
    };
  }, [menuOpen, profileMenuOpen]);

  useEffect(() => {
    document.body.classList.toggle("menu-open", menuOpen);
    return () => {
      document.body.classList.remove("menu-open");
    };
  }, [menuOpen]);

  useEffect(() => {
    setProfileDraftName(auth.profile?.displayName || "");
    setProfileDraftAvatar(auth.profile?.avatarUrl || "");
  }, [auth.profile?.displayName, auth.profile?.avatarUrl]);

  useEffect(() => {
    if (!profileDraftFile) {
      setProfilePreviewUrl("");
      return undefined;
    }

    const objectUrl = URL.createObjectURL(profileDraftFile);
    setProfilePreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [profileDraftFile]);

  async function handleProfileSave(event) {
    event.preventDefault();
    const trimmedName = profileDraftName.trim();
    let nextAvatarUrl = profileDraftAvatar.trim();

    if (!trimmedName) {
      setProfileError("Display name is required.");
      return;
    }

    setProfileBusy(true);
    setProfileError("");

    try {
      if (profileDraftFile) {
        nextAvatarUrl = await auth.uploadProfileAvatar(profileDraftFile);
      }

      await auth.updateProfile({
        displayName: trimmedName,
        avatarUrl: nextAvatarUrl,
      });
      setProfileDraftAvatar(nextAvatarUrl);
      setProfileDraftFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setProfileMenuOpen(false);
    } catch (error) {
      setProfileError(error.message || "Could not update your profile.");
    } finally {
      setProfileBusy(false);
    }
  }

  function handleProfileTriggerClick() {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches) {
      setMenuOpen(false);
      setProfileMenuOpen(false);
      navigateWithTransition("/account");
      return;
    }

    setProfileMenuOpen((value) => !value);
    setProfileError("");
  }

  return (
    <>
      <button
        className="ham"
        aria-label={menuOpen ? "Close menu" : "Open menu"}
        aria-expanded={menuOpen}
        aria-controls="rightnav"
        type="button"
        onClick={() => setMenuOpen((value) => !value)}
      >
        <div className="line"></div>
        <div className="line"></div>
        <div className="line"></div>
      </button>
      <div className="navbar">
        <div id="leftnav">
          <TransitionLink href="/" style={{ textDecoration: "none", color: "inherit" }}>
            <h4>DEXTERITYCODER</h4>
          </TransitionLink>
        </div>
        <div id="rightnav">
          {navStatus ? (
            <div className="nav-status" aria-label="Current location">
              <span className="nav-status-label">{navStatus.eyebrow}</span>
              <div className="nav-status-trail">
                {navStatus.trail.map((item, index) => (
                  item.href ? (
                    <span className="nav-status-segment" key={`${item.label}-${item.href}`}>
                      <TransitionLink href={item.href} className="nav-status-link" onClick={() => setMenuOpen(false)}>
                        {item.label}
                      </TransitionLink>
                      {index < navStatus.trail.length - 1 ? <span className="nav-status-separator">/</span> : null}
                    </span>
                  ) : (
                    <span className="nav-status-segment" key={`${item.label}-${index}`}>
                      <span className="nav-status-current">{item.label}</span>
                      {index < navStatus.trail.length - 1 ? <span className="nav-status-separator">/</span> : null}
                    </span>
                  )
                ))}
              </div>
            </div>
          ) : null}
          <ul id="rightnavul">
            {navItems.map((item) => (
              <TransitionLink
                key={item.href}
                href={item.href}
                className={`nav-item-link${item.active ? " is-active" : ""}`}
                aria-current={item.active ? "page" : undefined}
                onClick={() => setMenuOpen(false)}
              >
                <li>
                  <span className="nav-item-label">{formatPathLabel(item.label)}</span>
                  <span className="nav-item-icon" aria-hidden="true">{item.icon}</span>
                </li>
              </TransitionLink>
            ))}
            {auth.user ? (
              <li
                className={`nav-profile-item${profileMenuOpen ? " is-open" : ""}`}
                onMouseEnter={() => {
                  setProfileMenuOpen(true);
                  setProfileError("");
                }}
                onMouseLeave={() => {
                  setProfileMenuOpen(false);
                  setProfileError("");
                }}
              >
                <button
                  type="button"
                  className="nav-profile-trigger"
                  aria-label="Open profile menu"
                  aria-expanded={profileMenuOpen}
                  onClick={handleProfileTriggerClick}
                >
                  {profilePreviewUrl || getAvatarUrl(auth.profile) ? (
                    <img
                      className="nav-profile-avatar"
                      src={profilePreviewUrl || getAvatarUrl(auth.profile)}
                      alt={getDisplayNameFromProfile(auth.profile, auth.user)}
                    />
                  ) : (
                    <span className="nav-profile-avatar nav-profile-avatar-fallback">
                      {getAvatarFallback(auth.profile, auth.user)}
                    </span>
                  )}
                </button>
                <div className="nav-profile-menu">
                  <div className="nav-profile-summary">
                    {profilePreviewUrl || getAvatarUrl(auth.profile) ? (
                      <img
                        className="nav-profile-summary-avatar"
                        src={profilePreviewUrl || getAvatarUrl(auth.profile)}
                        alt={getDisplayNameFromProfile(auth.profile, auth.user)}
                      />
                    ) : (
                      <span className="nav-profile-summary-avatar nav-profile-avatar-fallback">
                        {getAvatarFallback(auth.profile, auth.user)}
                      </span>
                    )}
                    <div>
                      <strong>{getDisplayNameFromProfile(auth.profile, auth.user)}</strong>
                      <p>{auth.user.email}</p>
                    </div>
                  </div>
                  <TransitionLink
                    href="/account"
                    className="nav-profile-link"
                    onClick={() => {
                      setMenuOpen(false);
                      setProfileMenuOpen(false);
                    }}
                  >
                    View Profile
                  </TransitionLink>
                  <form className="nav-profile-form" onSubmit={handleProfileSave}>
                    <label>
                      <span>Edit name</span>
                      <input
                        type="text"
                        value={profileDraftName}
                        onChange={(event) => setProfileDraftName(event.target.value)}
                        maxLength={80}
                        placeholder="Display name"
                      />
                    </label>
                    <label>
                      <span>Profile picture</span>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="nav-profile-file-input"
                        onChange={(event) => {
                          const nextFile = event.target.files?.[0] || null;
                          setProfileDraftFile(nextFile);
                          setProfileError("");
                        }}
                      />
                    </label>
                    <div className="nav-profile-upload-row">
                      <button
                        type="button"
                        className="nav-profile-upload-btn"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        {profileDraftFile ? "Choose Another Image" : "Upload Image"}
                      </button>
                      {profileDraftFile ? <span className="nav-profile-file-name">{profileDraftFile.name}</span> : null}
                    </div>
                    <label>
                      <span>Or paste image URL</span>
                      <input
                        type="url"
                        value={profileDraftAvatar}
                        onChange={(event) => setProfileDraftAvatar(event.target.value)}
                        placeholder="https://example.com/avatar.jpg"
                      />
                    </label>
                    {profilePreviewUrl ? <p className="nav-profile-helper">New image selected. Save changes to apply it.</p> : null}
                    {profileError ? <p className="nav-profile-error">{profileError}</p> : null}
                    <button type="submit" className="nav-profile-save" disabled={profileBusy}>
                      {profileBusy ? "Saving..." : "Save Changes"}
                    </button>
                  </form>
                  <button
                    type="button"
                    className="nav-profile-logout"
                    onClick={() => {
                      setMenuOpen(false);
                      setProfileMenuOpen(false);
                      auth.signOutUser().catch(() => {
                        // Error state is already tracked by auth.
                      });
                    }}
                  >
                    Log Out
                  </button>
                </div>
              </li>
            ) : (
              <TransitionLink href="/auth" className="nav-auth-cta" onClick={() => setMenuOpen(false)}>
                <li>
                  <span className="nav-item-icon" aria-hidden="true">{getNavItemIcon("/auth")}</span>
                  <span className="nav-item-label">Sign Up</span>
                </li>
              </TransitionLink>
            )}
          </ul>
        </div>
      </div>
    </>
  );
}

function Hero({ titleHtml, backgroundImage, titleStyle, meta, heroClassName = "hero" }) {
  const style = backgroundImage
    ? {
        backgroundImage: `linear-gradient(rgba(18, 18, 18, 0.38), rgba(18, 18, 18, 0.58)), url('${backgroundImage}')`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
    : undefined;

  return (
    <section className={heroClassName} style={style}>
      <div className="hero-inner">
        <h1 style={titleStyle} dangerouslySetInnerHTML={{ __html: titleHtml }}></h1>
        {meta ? <p className="project-hero-meta">{meta}</p> : null}
      </div>
    </section>
  );
}

function Gallery({ items }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [itemsPerView, setItemsPerView] = useState(getItemsPerView());
  const [activeImageIndex, setActiveImageIndex] = useState(-1);
  const touchStartXRef = useRef(0);
  const touchDeltaXRef = useRef(0);

  useEffect(() => {
    function handleResize() {
      setItemsPerView(getItemsPerView());
    }

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    const maxIndex = Math.max(items.length - itemsPerView, 0);
    setCurrentIndex((index) => Math.min(index, maxIndex));
  }, [items.length, itemsPerView]);

  useEffect(() => {
    if (activeImageIndex < 0) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setActiveImageIndex(-1);
      } else if (event.key === "ArrowLeft") {
        setActiveImageIndex((index) => (index <= 0 ? items.length - 1 : index - 1));
      } else if (event.key === "ArrowRight") {
        setActiveImageIndex((index) => (index >= items.length - 1 ? 0 : index + 1));
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeImageIndex, items.length]);

  const maxIndex = Math.max(items.length - itemsPerView, 0);
  const offsetPercent = itemsPerView === 1 ? 100 : itemsPerView === 2 ? 50 : 33.333333;

  function showPreviousSlide() {
    setCurrentIndex((index) => Math.max(index - 1, 0));
  }

  function showNextSlide() {
    setCurrentIndex((index) => Math.min(index + 1, maxIndex));
  }

  function showPreviousImage() {
    setActiveImageIndex((index) => (index <= 0 ? items.length - 1 : index - 1));
  }

  function showNextImage() {
    setActiveImageIndex((index) => (index >= items.length - 1 ? 0 : index + 1));
  }

  function handleTouchStart(event) {
    touchStartXRef.current = event.touches[0]?.clientX || 0;
    touchDeltaXRef.current = 0;
  }

  function handleTouchMove(event) {
    const currentX = event.touches[0]?.clientX || 0;
    touchDeltaXRef.current = currentX - touchStartXRef.current;
  }

  function handleTouchEnd() {
    const threshold = 45;
    if (touchDeltaXRef.current <= -threshold) {
      showNextSlide();
    } else if (touchDeltaXRef.current >= threshold) {
      showPreviousSlide();
    }

    touchStartXRef.current = 0;
    touchDeltaXRef.current = 0;
  }

  return (
    <>
      <div className="gallery-container">
        <div className="gallery-title">GALLERY</div>
        <div
          className="gallery-viewport"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div
            className="gallery-slider"
            style={{ transform: `translateX(-${currentIndex * offsetPercent}%)` }}
          >
            {items.map((item, index) => (
              <button
                key={item.image}
                type="button"
                className="gallery-item"
                onClick={() => setActiveImageIndex(index)}
                aria-label={`Open image ${index + 1} of ${items.length}`}
              >
                <img src={item.image} alt={item.alt} />
              </button>
            ))}
          </div>
        </div>
        <button
          className="gallery-button left"
          type="button"
          aria-label="Previous gallery items"
          onClick={showPreviousSlide}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <path d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <button
          className="gallery-button right"
          type="button"
          aria-label="Next gallery items"
          onClick={showNextSlide}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {activeImageIndex >= 0 ? (
        <div
          className="gallery-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Image viewer"
          onClick={() => setActiveImageIndex(-1)}
        >
          <div className="gallery-modal-inner" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="gallery-modal-close"
              aria-label="Close image viewer"
              onClick={() => setActiveImageIndex(-1)}
            >
              ×
            </button>
            <button
              type="button"
              className="gallery-modal-nav left"
              aria-label="Previous image"
              onClick={showPreviousImage}
            >
              ‹
            </button>
            <figure className="gallery-modal-figure">
              <img src={items[activeImageIndex]?.image} alt={items[activeImageIndex]?.alt || "Gallery image"} />
              {items[activeImageIndex]?.alt ? <figcaption>{items[activeImageIndex].alt}</figcaption> : null}
            </figure>
            <button
              type="button"
              className="gallery-modal-nav right"
              aria-label="Next image"
              onClick={showNextImage}
            >
              ›
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function getNavItemIcon(href) {
  switch (href) {
    case "/":
      return <NavHomeIcon />;
    case "/works":
      return <NavWorkIcon />;
    case "/writings":
      return <NavWritingIcon />;
    case "/donate":
      return <NavDonateIcon />;
    case "/contact":
      return <NavContactIcon />;
    case "/about":
      return <NavAboutIcon />;
    case "/auth":
      return <NavUserIcon />;
    default:
      return <NavDotIcon />;
  }
}

function NavIconFrame({ children }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

function NavHomeIcon() {
  return <NavIconFrame><path d="M3 10.5 12 3l9 7.5"></path><path d="M5.5 9.5V20h13V9.5"></path><path d="M9.5 20v-5.5h5V20"></path></NavIconFrame>;
}

function NavWorkIcon() {
  return <NavIconFrame><rect x="3.5" y="5" width="17" height="14" rx="2"></rect><path d="M8 5V3.5h8V5"></path><path d="M3.5 10.5h17"></path></NavIconFrame>;
}

function NavWritingIcon() {
  return <NavIconFrame><path d="M6 4.5h9l3 3V19.5H6z"></path><path d="M15 4.5v3h3"></path><path d="M9 12h6"></path><path d="M9 15.5h6"></path></NavIconFrame>;
}

function NavDonateIcon() {
  return <NavIconFrame><path d="M12 20s-6.5-3.8-6.5-9.2A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 6.5 2.8C18.5 16.2 12 20 12 20Z"></path><path d="M12 6V4"></path></NavIconFrame>;
}

function NavContactIcon() {
  return <NavIconFrame><path d="M4 6.5h16v11H4z"></path><path d="m4.5 7 7.5 6 7.5-6"></path></NavIconFrame>;
}

function NavAboutIcon() {
  return <NavIconFrame><circle cx="12" cy="8" r="3"></circle><path d="M5.5 19c1.5-3 4-4.5 6.5-4.5S17 16 18.5 19"></path></NavIconFrame>;
}

function NavUserIcon() {
  return <NavIconFrame><circle cx="12" cy="8" r="3"></circle><path d="M5.5 19c1.5-3 4-4.5 6.5-4.5S17 16 18.5 19"></path></NavIconFrame>;
}

function NavDotIcon() {
  return <NavIconFrame><circle cx="12" cy="12" r="2.5"></circle></NavIconFrame>;
}

function getItemsPerView() {
  if (window.innerWidth <= 680) {
    return 1;
  }
  if (window.innerWidth <= 1200) {
    return 2;
  }
  return 3;
}

function useViewTracker(engagement, entityType, entityId) {
  const trackedRef = useRef("");

  useEffect(() => {
    if (!entityType || !entityId) {
      return;
    }

    const key = entityKey(entityType, entityId);
    if (trackedRef.current === key) {
      return;
    }

    trackedRef.current = key;
    engagement.incrementView({ entityType, entityId }).catch(() => {
      // Shared engagement state already records the error.
    });
  }, [engagement, entityId, entityType]);
}

function WorkCard({ card, stats, engagement, entityType = "article", entityId = card.slug }) {
  const navigateWithTransition = useTransitionNavigate();
  const fallbackViewCount = parseLooseCount(card.views);
  const fallbackCommentCount = parseLooseCount(card.comments);
  const fallbackLikeCount = parseLooseCount(card.likes);
  const viewCount = stats && Number(stats.viewCount) > 0 ? stats.viewCount : fallbackViewCount;
  const commentCount = stats ? stats.commentCount : fallbackCommentCount;
  const likeCount = stats ? stats.likeCount : fallbackLikeCount;

  return (
    <div
      className="blog-card"
      data-post={card.slug}
      onClick={() => navigateWithTransition(`/${card.slug}`)}
    >
      <LikeButton
        entityType={entityType}
        entityId={entityId}
        engagement={engagement}
        className="card-like-button"
        showCount={false}
      />
      <div className="blog-card-media">
        <img src={card.image} alt="Dexteritycoder featured post" />
      </div>
      <div className="blog-content">
        <div className="meta">{card.meta}</div>
        <h3>{card.title}</h3>
        <p>{card.description}</p>
        <div className="blog-footer">
          <span className="views">{formatCount(viewCount)} views</span>
          <span className="comments">{formatCount(commentCount)} comments</span>
          <span className="like">{formatCount(likeCount)} likes</span>
        </div>
      </div>
    </div>
  );
}

function MarkdownContent({ markdown }) {
  return <section className="post-content" dangerouslySetInnerHTML={{ __html: markdownToHtml(markdown) }}></section>;
}

function Shell({ siteData, auth, children }) {
  return (
    <>
      <Navbar siteData={siteData} auth={auth || { user: null, signOutUser: async () => {} }} />
      {children}
      <SocialFooter footer={siteData.footer} />
    </>
  );
}

function HomePage({ siteData, engagement, auth }) {
  usePageSetup("Dexteritycoder", "home-page");

  return (
    <Shell siteData={siteData} auth={auth}>
      <Hero titleHtml={siteData.home.heroTitleHtml} />
      <section className="home-blog-grid">
        {siteData.home.works.map((card) => (
          <WorkCard
            key={card.slug}
            card={card}
            stats={getEntityStats(engagement.statsMap, "article", card.slug)}
            engagement={engagement}
          />
        ))}
      </section>
      <div className="all_posts_btn">
        <center>
          <TransitionLink href="/works">
            <button type="button">View All Works</button>
          </TransitionLink>
        </center>
      </div>
      <Gallery items={siteData.home.gallery} />
    </Shell>
  );
}

function WorksPage({ siteData, engagement, auth }) {
  usePageSetup("Writings | Dexteritycoder", "home-page");

  const cards = siteData.home.works.map((card) => ({
    ...card,
    views: card.views,
    comments: "0 comments",
    likes: "20",
  }));

  return (
    <Shell siteData={siteData} auth={auth}>
      <Hero titleHtml={siteData.works.listing.heroTitleHtml} />
      <section className="home-blog-grid">
        {cards.map((card) => (
          <WorkCard
            key={card.slug}
            card={card}
            stats={getEntityStats(engagement.statsMap, "article", card.slug)}
            engagement={engagement}
          />
        ))}
      </section>
    </Shell>
  );
}

function WorkMarkdownPage({ siteData, slug, production = false, engagement, auth, content }) {
  const managedPage = resolvePageManagedEntry("works", slug, content);
  const page = {
    ...siteData.works.pages[slug],
    title: managedPage?.title || siteData.works.pages[slug].title,
    documentTitle: managedPage?.documentTitle || siteData.works.pages[slug].documentTitle,
    heroTitle: managedPage?.title || siteData.works.pages[slug].heroTitle,
    heroImage: managedPage?.heroImage || siteData.works.pages[slug].heroImage,
    meta: managedPage?.meta || siteData.works.pages[slug].meta,
    ctaLabel: managedPage?.ctaLabel || siteData.works.pages[slug].ctaLabel,
    ctaHref: managedPage?.ctaHref || siteData.works.pages[slug].ctaHref,
  };
  const { data, error, loading } = useText(page.markdownPath);
  const [projects, setProjects] = useState([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [projectEditorOpen, setProjectEditorOpen] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const [projectFilter, setProjectFilter] = useState("All");
  const navigateWithTransition = useTransitionNavigate();

  usePageSetup(page.documentTitle, "post-page");
  useViewTracker(engagement, "article", slug);

  useEffect(() => {
    if (!production) {
      return undefined;
    }

    let active = true;
    loadProjectsFromJson()
      .then((items) => {
        if (active) {
          setProjects(mergeProjects(normalizeData(items), content));
        }
      })
      .catch(() => {
        if (active) {
          setProjects(mergeProjects([], content));
        }
      });

    return () => {
      active = false;
    };
  }, [production, content]);

  async function handlePageEdit(form) {
    setEditorBusy(true);
    try {
      const response = await submitContentRequest({
        ...form,
        section: "works",
        contentType: "page",
        targetSlug: slug,
        requestKind: "edit",
      });
      await content.refresh();
      auth.setNotice(response?.message || "Page update submitted.");
      setEditorOpen(false);
    } catch (submitError) {
      auth.setError(submitError.message || "Could not submit the page update.");
    } finally {
      setEditorBusy(false);
    }
  }

  async function handleProjectCreate(form) {
    setEditorBusy(true);
    try {
      const response = await submitContentRequest({
        ...form,
        section: "projects",
        contentType: "project",
      });
      await content.refresh();
      auth.setNotice(response?.message || "Project request submitted.");
      setProjectEditorOpen(false);
    } catch (submitError) {
      auth.setError(submitError.message || "Could not submit the project.");
    } finally {
      setEditorBusy(false);
    }
  }

  const visibleProjects = projects.filter((project) => {
    const role = String(project.authorRole || "admin").trim().toLowerCase();
    if (projectFilter === "Members") {
      return role === "member";
    }
    if (projectFilter === "By Admin") {
      return role === "admin";
    }
    return true;
  });

  return (
    <Shell siteData={siteData} auth={auth}>
      <Hero
        titleHtml={page.heroTitle}
        backgroundImage={page.heroImage}
        titleStyle={{ fontSize: "clamp(1.45rem, 1.3vw + 1.05rem, 2.2rem)" }}
      />
      <main className="post-article production-projects-page">
        <article>
          {auth.profile?.role === "admin" ? (
            <ContentActionBar
              title="Edit this page"
              description="Update the hero copy and markdown for this work page."
              actionLabel="Edit Page"
              onClick={() => setEditorOpen(true)}
            />
          ) : null}
          <div className="meta">{page.meta}</div>
          {loading ? <section className="post-content"><p>Loading...</p></section> : null}
          {error ? <section className="post-content"><p>Error loading content.</p></section> : null}
          {!loading && !error ? <MarkdownContent markdown={managedPage?.markdown || data} /> : null}
          <TransitionLink href={page.ctaHref}>
            <button className="call-to-blog-button">{page.ctaLabel}</button>
          </TransitionLink>
          <div className="post-engagement-strip">
            <span className="post-engagement-comments">
              {formatCount(getEntityStats(engagement.statsMap, "article", slug).viewCount)} views
            </span>
            <LikeButton entityType="article" entityId={slug} engagement={engagement} className="detail-like-button" />
            <span className="post-engagement-comments">
              {formatCount(getEntityStats(engagement.statsMap, "article", slug).commentCount)} comments
            </span>
          </div>
          <CommentsPanel entityType="article" entityId={slug} engagement={engagement} title="Article Comments" />
        </article>
        {production ? (
          <section className="production-projects-section" aria-label="Featured production projects">
            {canManageContent(auth, "projects") ? (
              <ContentActionBar
                title="Production project requests"
                description="Admins publish projects immediately. Members can submit projects for review."
                actionLabel="New Project"
                onClick={() => setProjectEditorOpen(true)}
              />
            ) : null}
            <h2 className="production-projects-heading">Featured Projects</h2>
            <p className="production-projects-subtitle">
              Each card opens the README and repository files in your browser static frontend only, no backend server.
            </p>
            <div className="content-filter-bar" aria-label="Production project filters">
              {["All", "Members", "By Admin"].map((label) => (
                <button
                  key={label}
                  type="button"
                  className={`content-filter-btn${projectFilter === label ? " is-active" : ""}`}
                  onClick={() => setProjectFilter(label)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="project-cards-grid">
              {visibleProjects.map((project) => {
                const parsed = parseGithubUrl(project.github);
                const repo = parsed ? repoSlug(parsed.owner, parsed.repo) : "";

                return (
                  <article
                    key={project.github}
                    className="blog-card project-card"
                    onClick={() => navigateWithTransition(buildProjectRoute(repo))}
                  >
                <LikeButton
                  entityType="project"
                  entityId={project.id}
                  engagement={engagement}
                  className="card-like-button"
                  showCount={false}
                />
                    <div className="blog-card-media">
                      <img src={project.image} alt={project.title} />
                    </div>
                    <div className="blog-content">
                      <div className="meta">{project.meta || "Open Source"}</div>
                      <h3>{project.title}</h3>
                      <p>{project.description}</p>
                      <div className="blog-footer">
                        <span className="views">{formatCount(getEntityStats(engagement.statsMap, "project", project.id).viewCount)} views</span>
                        <span className="comments">
                          {formatCount(getEntityStats(engagement.statsMap, "project", project.id).commentCount)} comments
                        </span>
                        <span className="like">{formatCount(getEntityStats(engagement.statsMap, "project", project.id).likeCount)} likes</span>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}
      </main>
      <ContentEditorModal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSubmit={handlePageEdit}
        busy={editorBusy}
        title="Edit Work Page"
        initialValue={{
          id: managedPage?.id || "",
          section: "works",
          title: page.heroTitle || "",
          description: "",
          category: managedPage?.category || "",
          heroImage: page.heroImage || "",
          meta: page.meta || "",
          readTime: "",
          markdown: managedPage?.markdown || data || "",
          documentTitle: page.documentTitle || "",
          ctaLabel: page.ctaLabel || "",
          ctaHref: page.ctaHref || "",
          targetSlug: slug,
          requestKind: "edit",
        }}
      />
      <ContentEditorModal
        open={projectEditorOpen}
        onClose={() => setProjectEditorOpen(false)}
        onSubmit={handleProjectCreate}
        busy={editorBusy}
        title="Create Project Request"
        initialValue={{
          section: "projects",
          title: "",
          description: "",
          category: "General",
          heroImage: "",
          meta: "",
          githubUrl: "",
          markdown: "",
        }}
      />
    </Shell>
  );
}

function AboutPage({ siteData, auth, content }) {
  const managedPage = resolvePageManagedEntry("about", "about", content);
  const { data, error, loading } = useText(siteData.about.markdownPath);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const aboutData = {
    ...siteData.about,
    documentTitle: managedPage?.documentTitle || siteData.about.documentTitle,
    ctaLabel: managedPage?.ctaLabel || siteData.about.ctaLabel,
    ctaHref: managedPage?.ctaHref || siteData.about.ctaHref,
  };
  usePageSetup(aboutData.documentTitle);

  async function handleAboutEdit(form) {
    setEditorBusy(true);
    try {
      const response = await submitContentRequest({
        ...form,
        section: "about",
        contentType: "page",
        targetSlug: "about",
        requestKind: "edit",
      });
      await content.refresh();
      auth.setNotice(response?.message || "About page updated.");
      setEditorOpen(false);
    } catch (submitError) {
      auth.setError(submitError.message || "Could not submit the about page update.");
    } finally {
      setEditorBusy(false);
    }
  }

  return (
    <Shell siteData={siteData} auth={auth}>
      <Hero
        titleHtml={siteData.about.heroTitleHtml}
        titleStyle={{ fontSize: "clamp(1.45rem, 1.3vw + 1.05rem, 2.2rem)" }}
      />
      <main className="post-article">
        <article>
          {auth.profile?.role === "admin" ? (
            <ContentActionBar
              title="Edit about page"
              description="Update your about page in markdown."
              actionLabel="Edit Page"
              onClick={() => setEditorOpen(true)}
            />
          ) : null}
          {loading ? <section className="post-content"><p>Loading...</p></section> : null}
          {error ? <section className="post-content"><p>Error loading content.</p></section> : null}
          {!loading && !error ? <MarkdownContent markdown={managedPage?.markdown || data} /> : null}
        </article>
        <TransitionLink href={aboutData.ctaHref}>
          <button className="call-to-blog-button">{aboutData.ctaLabel}</button>
        </TransitionLink>
      </main>
      <Gallery items={siteData.about.gallery} />
      <ContentEditorModal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSubmit={handleAboutEdit}
        busy={editorBusy}
        title="Edit About Page"
        initialValue={{
          id: managedPage?.id || "",
          section: "about",
          title: "About",
          description: "",
          category: managedPage?.category || "",
          heroImage: "",
          meta: "",
          markdown: managedPage?.markdown || data || "",
          documentTitle: aboutData.documentTitle || "",
          ctaLabel: aboutData.ctaLabel || "",
          ctaHref: aboutData.ctaHref || "",
          targetSlug: "about",
          requestKind: "edit",
        }}
      />
    </Shell>
  );
}

function ContactPage({ siteData, auth }) {
  usePageSetup(siteData.contact.documentTitle);

  return (
    <Shell siteData={siteData} auth={auth}>
      <Hero
        titleHtml={siteData.contact.heroTitleHtml}
        titleStyle={{ fontSize: "clamp(1.45rem, 1.3vw + 1.05rem, 2.2rem)" }}
      />
      <div className="contact-form-container">
        <form className="contact-form">
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="fullName">Full Name</label>
              <input type="text" id="fullName" name="fullName" placeholder="Enter your full name" required />
            </div>
            <div className="form-group">
              <label htmlFor="email">Email Address</label>
              <input type="email" id="email" name="email" placeholder="Enter your email address" required />
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="message">Message</label>
            <textarea id="message" name="message" rows="5" placeholder="Write your message..." required></textarea>
          </div>
          <br />
          <button type="submit" className="submit-btn">Send Message</button>
        </form>
      </div>
    </Shell>
  );
}

function DonatePage({ siteData, auth }) {
  usePageSetup(siteData.donate.documentTitle);

  return (
    <Shell siteData={siteData} auth={auth}>
      <Hero
        titleHtml={siteData.donate.heroTitleHtml}
        titleStyle={{ fontSize: "clamp(1.45rem, 1.3vw + 1.05rem, 2.2rem)" }}
      />
      <div className="donate-container">
        <div className="donate-text">
          <h2 style={{ marginTop: 0 }}>{siteData.donate.heading}</h2>
          <p>{siteData.donate.description}</p>
        </div>
        <div className="donate-iframe-container">
          <iframe id="donate-iframe" src={siteData.donate.iframeUrl} frameBorder="0" allowFullScreen></iframe>
        </div>
      </div>
    </Shell>
  );
}

function BlogListPage({ siteData, engagement, auth, content }) {
  const { data, error, loading } = useJson("/BlogPosts/posts.json");
  const [search, setSearch] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const [activeCategory, setActiveCategory] = useState("All");
  const navigateWithTransition = useTransitionNavigate();
  usePageSetup(siteData.blogs.documentTitle, "home-page");

  const posts = mergeBlogPosts(
    Array.isArray(data)
      ? [...data].reverse().map((post) => ({
          ...post,
          category: post.category || "General",
          authorRole: "admin",
        }))
      : [],
    content
  );
  const categories = ["All", ...new Set(posts.map((post) => String(post.category || "General").trim() || "General"))];
  const filteredPosts = posts.filter((post) => {
    const term = search.toLowerCase().trim();
    const matchesCategory = activeCategory === "All" || String(post.category || "General") === activeCategory;
    if (!matchesCategory) {
      return false;
    }
    if (!term) {
      return true;
    }

    return (
      post.title.toLowerCase().includes(term) ||
      post.description.toLowerCase().includes(term) ||
      post.author.toLowerCase().includes(term)
    );
  });

  async function handleCreatePost(form) {
    setEditorBusy(true);
    try {
      const response = await submitContentRequest({
        ...form,
        section: "writings",
        contentType: "blog",
      });
      await content.refresh();
      auth.setNotice(response?.message || "Post request submitted.");
      setEditorOpen(false);
    } catch (submitError) {
      auth.setError(submitError.message || "Could not submit the post.");
    } finally {
      setEditorBusy(false);
    }
  }

  return (
    <Shell siteData={siteData} auth={auth}>
      <Hero titleHtml={siteData.blogs.heroTitleHtml} />
      {canManageContent(auth, "writings") ? (
        <section className="post-article">
          <ContentActionBar
            title="New Writing"
            description="Admins publish immediately. Members can send a writing request for approval."
            actionLabel="New Post"
            onClick={() => setEditorOpen(true)}
          />
        </section>
      ) : null}
      <div className="blog-search-container">
        <input
          type="text"
          id="blog-search"
          placeholder={siteData.blogs.searchPlaceholder}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <svg className="blog-search-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"></circle>
          <path d="m21 21-4.35-4.35"></path>
        </svg>
      </div>
      <div className="content-filter-bar" aria-label="Writing categories">
        {categories.map((category) => (
          <button
            key={category}
            type="button"
            className={`content-filter-btn${activeCategory === category ? " is-active" : ""}`}
            onClick={() => setActiveCategory(category)}
          >
            {category}
          </button>
        ))}
      </div>
      <section className="home-blog-grid" id="blog-grid">
        {loading ? <p>Loading...</p> : null}
        {error ? <p style={{ color: "white", textAlign: "center" }}>Error loading writings</p> : null}
        {!loading && !error
          ? filteredPosts.map((post) => (
              <div
                key={post.id}
                className="blog-card"
                data-blog={post.id}
                onClick={() => navigateWithTransition(buildWritingRoute(post.id))}
              >
                <LikeButton
                  entityType="blog"
                  entityId={post.id}
                  engagement={engagement}
                  className="card-like-button"
                  showCount={false}
                />
                <div className="blog-card-media">
                  <img src={post.image} alt={post.title} />
                </div>
                <div className="blog-content">
                  <div className="meta">{`${post.author} · ${post.date} · ${post.readTime}`}</div>
                  <h3>{post.title}</h3>
                  <p>{post.description}</p>
                  <div className="blog-footer">
                    <span className="views">{formatCount(getEntityStats(engagement.statsMap, "blog", post.id).viewCount || post.views)} views</span>
                    <span className="comments">
                      {formatCount(getEntityStats(engagement.statsMap, "blog", post.id).commentCount || post.comments)} comments
                    </span>
                    <span className="like">{formatCount(getEntityStats(engagement.statsMap, "blog", post.id).likeCount || post.likes)} likes</span>
                  </div>
                </div>
              </div>
            ))
          : null}
      </section>
      <ContentEditorModal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSubmit={handleCreatePost}
        busy={editorBusy}
        title="Write a New Post"
        initialValue={{
          section: "writings",
          title: "",
          description: "",
          category: "General",
          heroImage: "",
          meta: "",
          readTime: "",
          markdown: "",
        }}
      />
    </Shell>
  );
}

function BlogDetailPage({ siteData, engagement, auth, content }) {
  const location = useLocation();
  const { blogId: blogIdParam } = useParams();
  const blogId = blogIdParam || new URLSearchParams(location.search).get("blog");
  const { data: posts } = useJson("/BlogPosts/posts.json");
  const [markdown, setMarkdown] = useState("");
  const [error, setError] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);

  const mergedPosts = mergeBlogPosts(Array.isArray(posts) ? posts : [], content);
  const post = Array.isArray(mergedPosts) ? mergedPosts.find((item) => item.id === blogId) : null;
  const managedEntry = resolveBlogManagedEntry(blogId, content);
  usePageSetup(post ? `${post.title} | Dexteritycoder` : "Writings | Dexteritycoder", "post-page");
  useViewTracker(engagement, "blog", blogId);

  useEffect(() => {
    let active = true;

    async function load() {
      if (!blogId) {
        setError(new Error("Writing not found"));
        return;
      }

      if (managedEntry?.markdown) {
        setMarkdown(managedEntry.markdown);
        setError(null);
        return;
      }

      try {
        const response = await fetch(`/BlogPosts/${blogId}.md`);
        if (!response.ok) {
          throw new Error("Writing not found");
        }

        const text = await response.text();
        if (active) {
          setMarkdown(fixText(text));
          setError(null);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError);
        }
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [blogId, managedEntry?.markdown]);

  async function handleEditPost(form) {
    setEditorBusy(true);
    try {
      const response = await submitContentRequest({
        ...form,
        section: "writings",
        contentType: "blog",
        targetSlug: slugifyValue(blogId),
        requestKind: "edit",
      });
      await content.refresh();
      auth.setNotice(response?.message || "Post update submitted.");
      setEditorOpen(false);
    } catch (submitError) {
      auth.setError(submitError.message || "Could not submit the update.");
    } finally {
      setEditorBusy(false);
    }
  }

  const heroHtml = post ? post.title : "Writing Not Found";

  return (
    <Shell siteData={siteData} auth={auth}>
      <Hero
        titleHtml={heroHtml}
        backgroundImage={post?.image}
        titleStyle={{ fontSize: "clamp(1.45rem, 1.3vw + 1.05rem, 2.2rem)" }}
        heroClassName="hero"
      />
      <main className="post-article">
        <article>
          {canManageContent(auth, "writings") ? (
            <ContentActionBar
              title="Edit this writing"
              description="Publish or request changes to this writing in markdown."
              actionLabel="Edit Post"
              onClick={() => setEditorOpen(true)}
            />
          ) : null}
          <div className="meta" id="blog-meta">
            {post ? `${post.author} · ${post.date} · ${post.readTime}` : "Loading..."}
          </div>
          {error ? <section className="post-content"><p>{error.message}</p></section> : null}
          {!error && markdown ? <MarkdownContent markdown={markdown} /> : null}
          {!error && !markdown ? <section className="post-content"><p>Loading...</p></section> : null}
          {blogId ? (
            <>
              <div className="post-engagement-strip">
                <span className="post-engagement-comments">
                  {formatCount(getEntityStats(engagement.statsMap, "blog", blogId).viewCount || post?.views)} views
                </span>
                <LikeButton entityType="blog" entityId={blogId} engagement={engagement} className="detail-like-button" />
                <span className="post-engagement-comments">
                  {formatCount(getEntityStats(engagement.statsMap, "blog", blogId).commentCount)} comments
                </span>
              </div>
              <CommentsPanel entityType="blog" entityId={blogId} engagement={engagement} title="Writing Comments" />
            </>
          ) : null}
        </article>
      </main>
      <ContentEditorModal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSubmit={handleEditPost}
        busy={editorBusy}
        title="Edit Writing"
        initialValue={{
          id: managedEntry?.id || "",
          section: "writings",
          title: post?.title || "",
          description: post?.description || "",
          category: post?.category || "General",
          heroImage: post?.image || "",
          meta: "",
          readTime: post?.readTime || "",
          markdown: managedEntry?.markdown || markdown || "",
          targetSlug: slugifyValue(blogId),
          requestKind: "edit",
        }}
      />
    </Shell>
  );
}

function TreeNode({ node, onSelect, activePath, depth = 0 }) {
  const children = [...(node.children || [])].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "dir" ? -1 : 1;
    }
    return b.name.localeCompare(a.name);
  });

  return children.map((child) => {
    const icon = child.type === "dir" ? <FolderIcon /> : <FileIcon />;
    const style = child.type === "dir" ? { paddingLeft: `${depth * 14}px` } : { paddingLeft: `${depth * 14 + 14}px` };

    if (child.type === "dir") {
      return (
        <details className="repo-tree-folder" open key={child.path}>
          <summary className="repo-tree-item repo-tree-folder-label" style={style}>
            <span className="repo-tree-icon">{icon}</span>
            <span>{child.name}</span>
          </summary>
          <TreeNode node={child} onSelect={onSelect} activePath={activePath} depth={depth + 1} />
        </details>
      );
    }

    return (
      <button
        type="button"
        key={child.path}
        className={`repo-tree-item repo-tree-file${activePath === child.path ? " is-active" : ""}`}
        style={style}
        onClick={() => onSelect(child)}
      >
        <span className="repo-tree-icon">{icon}</span>
        <span>{child.name}</span>
      </button>
    );
  });
}

function FolderIcon() {
  return (
    <svg className="repo-tree-icon-svg repo-tree-icon-folder" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z"></path>
    </svg>
  );
}

function FileIcon() {
  return (
    <svg className="repo-tree-icon-svg repo-tree-icon-file" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2 1.75C2 .784 2.784 0 3.75 0h5.086c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 11.25 16h-7.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 7 4.25V1.5Zm5.75.086v2.25a.25.25 0 0 0 .25.25h2.25L6.75 1.5Z"></path>
    </svg>
  );
}

function ProjectDetailPage({ siteData, engagement, auth, content }) {
  const location = useLocation();
  const { owner: ownerParam, repo: repoParam } = useParams();
  const repoQuery =
    ownerParam && repoParam
      ? `${decodeURIComponent(ownerParam)}/${decodeURIComponent(repoParam)}`
      : new URLSearchParams(location.search).get("repo");
  const [state, setState] = useState({
    loading: true,
    error: null,
    project: null,
    owner: "",
    repo: "",
    branch: "",
    tree: null,
    readmePath: "",
    readmeMarkdown: "",
    docsMarkdown: "",
    fileTitle: "README",
    fileHtml: "<p class='repo-empty-state'>Loading..</p>",
    activePath: "",
  });

  const heroTitle = state.project?.heroTitle || state.project?.title || state.repo || "Loading project..";
  const heroMeta = state.project?.meta || (state.owner && state.repo ? `${state.owner}/${state.repo} · ${state.branch}` : "");
  usePageSetup(`${heroTitle} - Dexteritycoder`, "home-page project-detail-page");
  useViewTracker(engagement, "project", state.project?.id || (!state.loading ? repoQuery : ""));

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        if (!repoQuery) {
          throw new Error("No repository specified.");
        }

        const [owner, repo] = repoQuery.split("/");
        if (!owner || !repo) {
          throw new Error("Invalid repository path. Use owner/repo.");
        }

        const projects = mergeProjects(normalizeData(await loadProjectsFromJson()), content);
        const project = projects.find((item) => {
          const parsed = parseGithubUrl(item.github);
          return parsed && repoSlug(parsed.owner, parsed.repo).toLowerCase() === repoSlug(owner, repo).toLowerCase();
        }) || null;

        const repoData = await loadRepoProject(owner, repo);
        const docsMarkdown = project?.docsMarkdown || (project ? await loadProjectDocumentation(project) : null);
        const fileHtml = `<div class="post-content repo-markdown">${markdownToHtml(
          rewriteReadmeAssets(repoData.readmeMarkdown, owner, repo, repoData.branch)
        )}</div>`;

        if (active) {
          setState({
            loading: false,
            error: null,
            project,
            owner,
            repo,
            branch: repoData.branch,
            tree: repoData.tree,
            readmePath: repoData.readmePath || "",
            readmeMarkdown: repoData.readmeMarkdown,
            docsMarkdown: docsMarkdown ? fixText(docsMarkdown) : "",
            fileTitle: repoData.readmePath || "README",
            fileHtml,
            activePath: repoData.readmePath || "",
          });
        }
      } catch (error) {
        if (active) {
          setState((current) => ({ ...current, loading: false, error }));
        }
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [repoQuery]);

  async function handleSelectFile(fileNode) {
    if (fileNode.size > 1024 * 1024) {
      setState((current) => ({
        ...current,
        fileTitle: fileNode.path,
        fileHtml: "<p class='repo-empty-state'>This file is larger than 1 MB and cannot be previewed here.</p>",
        activePath: fileNode.path,
      }));
      return;
    }

    setState((current) => ({
      ...current,
      fileTitle: fileNode.path,
      fileHtml: "<p class='repo-empty-state'>Loading file...</p>",
      activePath: fileNode.path,
    }));

    try {
      const file = await loadRepoFile(state.owner, state.repo, state.branch, fileNode.path);
      if (file.type === "image") {
        setState((current) => ({
          ...current,
          fileHtml: `<div class="repo-media-preview"><img src="${file.content}" alt="${fileNode.name}"></div>`,
        }));
        return;
      }

      if (/\.(md|markdown)$/i.test(fileNode.path)) {
        const markdown = rewriteReadmeAssets(file.content, state.owner, state.repo, state.branch);
        setState((current) => ({
          ...current,
          fileHtml: `<div class="post-content repo-markdown">${markdownToHtml(markdown)}</div>`,
        }));
        return;
      }

      setState((current) => ({
        ...current,
        fileHtml: `<pre class="repo-code-block"><code>${escapeHtml(fixText(file.content))}</code></pre>`,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        fileHtml: `<p class="repo-empty-state">${escapeHtml(error.message)}</p>`,
      }));
    }
  }

  async function copyCloneUrl() {
    const cloneUrl = `https://github.com/${state.owner}/${state.repo}.git`;
    await navigator.clipboard.writeText(cloneUrl);
  }

  return (
    <Shell siteData={siteData} auth={auth}>
      <Hero
        titleHtml={`<b>${heroTitle}</b>`}
        meta={heroMeta}
        heroClassName="hero"
      />
      <main className="project-detail-shell">
        <TransitionLink id="back-to-projects" className="project-back-link" href="/production-projects">
          Back to Production Projects
        </TransitionLink>
        <div className="project-detail-layout">
          <aside className="project-sidebar">
            <div className="project-sidebar-section">
              <h2>Project Actions</h2>
              <div className="project-actions">
                <button
                  className="github-btn"
                  onClick={() => window.open(state.project?.github || `https://github.com/${state.owner}/${state.repo}`, "_blank", "noopener,noreferrer")}
                >
                  GitHub Repo
                </button>
                <button className="github-btn clone-btn" onClick={copyCloneUrl}>
                  Clone
                </button>
              </div>
            </div>
            <div className="project-sidebar-section">
              <h2>Project Files</h2>
              <div id="project-tree" className="repo-tree">
                {state.loading ? <p className="repo-empty-state">Loading repository tree..</p> : null}
                {state.error ? <p className="repo-empty-state">{state.error.message}</p> : null}
                {state.tree ? (
                  <TreeNode node={state.tree} onSelect={handleSelectFile} activePath={state.activePath} />
                ) : null}
              </div>
            </div>
          </aside>
          <section className="project-file-viewer">
            <div className="project-file-viewer-header">
              <h2>{state.fileTitle}</h2>
            </div>
            <div
              id="file-content"
              className="project-file-content"
              dangerouslySetInnerHTML={{ __html: state.fileHtml }}
            ></div>
          </section>
        </div>
        <section className="project-documentation-section">
          <h2>{state.project?.title || "Project Documentation"}</h2>
          <div
            id="project-docs-content"
            className="post-content"
            dangerouslySetInnerHTML={{
              __html: state.docsMarkdown
                ? markdownToHtml(state.docsMarkdown)
                : "<p class='repo-empty-state'>No documentation available for this project yet.</p>",
            }}
          ></div>
          {repoQuery ? (
            <>
              <div className="post-engagement-strip">
                <span className="post-engagement-comments">
                  {formatCount(getEntityStats(engagement.statsMap, "project", state.project?.id || repoQuery).viewCount)} views
                </span>
                <LikeButton
                  entityType="project"
                  entityId={state.project?.id || repoQuery}
                  engagement={engagement}
                  className="detail-like-button"
                />
                <span className="post-engagement-comments">
                  {formatCount(getEntityStats(engagement.statsMap, "project", state.project?.id || repoQuery).commentCount)} comments
                </span>
              </div>
              <CommentsPanel
                entityType="project"
                entityId={state.project?.id || repoQuery}
                engagement={engagement}
                title="Project Comments"
              />
            </>
          ) : null}
        </section>
      </main>
    </Shell>
  );
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function LoadingScreen() {
  usePageSetup("Dexteritycoder");

  return (
    <main className="post-article">
      <p>Loading...</p>
    </main>
  );
}

function ContentActionBar({ title, description, actionLabel, onClick }) {
  return (
    <div className="content-action-bar">
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <button type="button" className="engagement-submit-btn" onClick={onClick}>
        {actionLabel}
      </button>
    </div>
  );
}

function ContentEditorModal({ initialValue, open, onClose, onSubmit, busy, title }) {
  const [form, setForm] = useState(initialValue);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setForm(initialValue);
    }

    wasOpenRef.current = open;
  }, [initialValue, open]);

  if (!open) {
    return null;
  }

  function updateField(name, value) {
    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    await onSubmit(form);
  }

  return (
    <div className="auth-modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="auth-modal-card cms-modal-card">
        <h2>{title}</h2>
        <form className="auth-form cms-form" onSubmit={handleSubmit}>
          <div className="cms-form-grid">
            <input
              type="text"
              placeholder="Title"
              value={form.title || ""}
              onChange={(event) => updateField("title", event.target.value)}
              required
            />
            <input
              type="text"
              placeholder="Category"
              value={form.category || ""}
              onChange={(event) => updateField("category", event.target.value)}
            />
            <input
              type="text"
              placeholder="Short description"
              value={form.description || ""}
              onChange={(event) => updateField("description", event.target.value)}
            />
            <input
              type="text"
              placeholder="Hero image URL"
              value={form.heroImage || ""}
              onChange={(event) => updateField("heroImage", event.target.value)}
            />
            <input
              type="text"
              placeholder="Meta line"
              value={form.meta || ""}
              onChange={(event) => updateField("meta", event.target.value)}
            />
            <input
              type="text"
              placeholder="Read time"
              value={form.readTime || ""}
              onChange={(event) => updateField("readTime", event.target.value)}
            />
            {form.section === "projects" ? (
              <input
                type="url"
                placeholder="GitHub URL"
                value={form.githubUrl || ""}
                onChange={(event) => updateField("githubUrl", event.target.value)}
              />
            ) : null}
            {(form.section === "works" || form.section === "about") ? (
              <>
                <input
                  type="text"
                  placeholder="Document title"
                  value={form.documentTitle || ""}
                  onChange={(event) => updateField("documentTitle", event.target.value)}
                />
                <input
                  type="text"
                  placeholder="CTA label"
                  value={form.ctaLabel || ""}
                  onChange={(event) => updateField("ctaLabel", event.target.value)}
                />
                <input
                  type="text"
                  placeholder="CTA href"
                  value={form.ctaHref || ""}
                  onChange={(event) => updateField("ctaHref", event.target.value)}
                />
              </>
            ) : null}
          </div>
          <div className="cms-editor-layout">
            <div className="cms-editor-panel">
              <div className="cms-panel-label">Markdown</div>
              <textarea
                className="cms-editor-textarea"
                rows="18"
                placeholder="Write in markdown..."
                value={form.markdown || ""}
                onChange={(event) => updateField("markdown", event.target.value)}
                required
              ></textarea>
            </div>
            <div className="cms-editor-panel">
              <div className="cms-panel-label">Live Preview</div>
              <div
                className="post-content cms-editor-preview"
                dangerouslySetInnerHTML={{ __html: markdownToHtml(form.markdown || "") }}
              ></div>
            </div>
          </div>
          <div className="auth-modal-actions">
            <button type="submit" className="engagement-submit-btn" disabled={busy}>
              {busy ? "Saving..." : "Submit"}
            </button>
            <button type="button" className="engagement-submit-btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AuthPromptModal({ message, onClose }) {
  const navigateWithTransition = useTransitionNavigate();

  if (!message) {
    return null;
  }

  return (
    <div className="auth-modal-backdrop" role="dialog" aria-modal="true" aria-label="Authentication required">
      <div className="auth-modal-card">
        <h2>Sign In Required</h2>
        <p>{message}</p>
        <div className="auth-modal-actions">
          <button type="button" className="engagement-submit-btn" onClick={() => navigateWithTransition("/auth")}>
            Open Sign Up / Login
          </button>
          <button type="button" className="engagement-like-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function AuthRoleDropdown({ role, onChange }) {
  const [open, setOpen] = useState(false);
  const [activeInfo, setActiveInfo] = useState("");
  const rootRef = useRef(null);
  const options = [
    { value: "visitor", label: "Visitor", note: "Can like, comment, and maintain a profile." },
    { value: "member", label: "Member", note: "Can publish through a review workflow later." },
    { value: "admin", label: "Admin", note: "Full control, best paired with an allowlist." },
  ];
  const selected = options.find((option) => option.value === role) || options[0];

  useEffect(() => {
    function handleClickOutside(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
        setActiveInfo("");
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setOpen(false);
        setActiveInfo("");
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <div className="auth-role-dropdown" ref={rootRef}>
      <span className="auth-role-select-label">Account type</span>
      <button
        type="button"
        className={`auth-role-trigger${open ? " is-open" : ""}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{selected.label}</span>
        <span className="auth-role-trigger-chevron" aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div className="auth-role-menu" role="listbox" aria-label="Account type options">
          {options.map((option) => (
            <div
              key={option.value}
              className={`auth-role-menu-option${role === option.value ? " is-active" : ""}`}
            >
              <button
                type="button"
                className="auth-role-menu-select"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                  setActiveInfo("");
                }}
              >
                <span className="auth-role-menu-label">{option.label}</span>
              </button>
              <button
                type="button"
                className="auth-role-menu-info"
                aria-label={option.note}
                title={option.note}
                onClick={(event) => {
                  event.stopPropagation();
                  setActiveInfo((current) => (current === option.value ? "" : option.value));
                }}
              >
                i
                <span className={`auth-role-menu-tooltip${activeInfo === option.value ? " is-visible" : ""}`}>
                  {option.note}
                </span>
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AuthPage({ siteData, auth }) {
  const [mode, setMode] = useState("signup");
  const [role, setRole] = useState("visitor");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [guideExpanded, setGuideExpanded] = useState(false);
  const navigateWithTransition = useTransitionNavigate();

  usePageSetup("Sign Up | Dexteritycoder", "post-page");

  useEffect(() => {
    if (auth.user) {
      navigateWithTransition("/account");
    }
  }, [auth.user]);

  async function handleEmailSubmit(event) {
    event.preventDefault();
    auth.setError("");
    auth.setNotice("");

    try {
      if (mode === "signup") {
        await auth.signUpWithEmail({
          displayName,
          email,
          password,
          requestedRole: role,
        });
      } else {
        await auth.signInWithEmail({
          email,
          password,
        });
        navigateWithTransition("/account");
      }
    } catch {
      // Shared auth state already holds the error.
    }
  }

  async function handleProviderSignIn(provider) {
    auth.setError("");
    auth.setNotice("");

    try {
      await auth.signInWithProvider(provider, role);
    } catch {
      // Shared auth state already holds the error.
    }
  }

  return (
    <Shell siteData={siteData} auth={auth}>
      <Hero titleHtml="<b>SIGN</b> UP / <b>LOG IN</b>" titleStyle={{ fontSize: "clamp(1.6rem, 1.4vw + 1rem, 2.4rem)" }} />
      <main className="auth-page-shell">
        <section className="auth-card auth-profile-card">
          <div className="auth-mode-switch">
            <button type="button" className={mode === "signup" ? "is-active" : ""} onClick={() => setMode("signup")}>
              Sign Up
            </button>
            <button type="button" className={mode === "login" ? "is-active" : ""} onClick={() => setMode("login")}>
              Log In
            </button>
          </div>

          {!auth.configured ? (
            <div className="auth-help-text">
              <p className="engagement-error">
                Authentication is temporarily unavailable because this site is missing its Supabase project URL and publishable key.
              </p>
              <p>
                Likes and comments can run from the database connection alone, but sign-up and OAuth still need a Supabase project URL and a publishable key so the browser can start an auth session.
              </p>
              <p>
                This site now tries to read those values from the deployed server environment first, using the same runtime pattern as the engagement API.
              </p>
            </div>
          ) : null}
          {auth.error ? <p className="engagement-error">{auth.error}</p> : null}
          {auth.notice ? <p className="auth-success">{auth.notice}</p> : null}

          {auth.configured ? (
            <>
              <div className="auth-role-picker">
                <AuthRoleDropdown role={role} onChange={setRole} />
              </div>

              <div className="auth-provider-grid">
                <button type="button" className="auth-provider-btn" onClick={() => handleProviderSignIn("google")} disabled={!auth.configured || auth.busy}>
                  <span className="auth-provider-icon" aria-hidden="true">
                    <img src="/images/google.svg" alt="" />
                  </span>
                  <span>Continue with Google</span>
                </button>
                <button type="button" className="auth-provider-btn" onClick={() => handleProviderSignIn("github")} disabled={!auth.configured || auth.busy}>
                  <span className="auth-provider-icon" aria-hidden="true">
                    <img src="/images/github.svg" alt="" />
                  </span>
                  <span>Continue with GitHub</span>
                </button>
              </div>

              <div className="auth-divider"><span>or use email</span></div>

              <form className="auth-form" onSubmit={handleEmailSubmit}>
                {mode === "signup" ? (
                  <div className="auth-form-row">
                    <input
                      type="text"
                      placeholder="Display name"
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      maxLength={80}
                      required
                    />
                    <input
                      type="email"
                      placeholder="Email address"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      maxLength={160}
                      required
                    />
                  </div>
                ) : null}
                {mode !== "signup" ? (
                  <input
                    type="email"
                    placeholder="Email address"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    maxLength={160}
                    required
                  />
                ) : null}
                <input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={8}
                  required
                />
                <button type="submit" className="auth-submit-btn" disabled={!auth.configured || auth.busy}>
                  {auth.busy ? "Working..." : mode === "signup" ? "Create Account" : "Log In"}
                </button>
              </form>
            </>
          ) : null}

          <div className="auth-help-text auth-help-text-guide">
            <p className={!guideExpanded ? "is-collapsed" : ""}>
              Use Google, GitHub, or email to create your account and continue where you left off. Your likes, comments,
              and profile activity stay connected to your signed-in account. Need admin access? Request it during sign up
              and approved emails will be elevated automatically.
            </p>
            <button
              type="button"
              className="auth-help-toggle"
              onClick={() => setGuideExpanded((current) => !current)}
              aria-expanded={guideExpanded}
            >
              {guideExpanded ? "Read less" : "Read more"}
            </button>
          </div>
        </section>
      </main>
    </Shell>
  );
}

function AuthCallbackPage({ siteData, auth }) {
  const navigate = useNavigate();
  usePageSetup("Signing In | Dexteritycoder", "post-page");

  useEffect(() => {
    if (!auth.loading && auth.callbackReady && auth.user) {
      navigate("/account", { replace: true });
    }
  }, [auth.loading, auth.callbackReady, auth.user, navigate]);

  const isWaiting = auth.loading || !auth.callbackReady;

  return (
    <Shell siteData={siteData} auth={auth}>
      <Hero titleHtml="<b>FINISHING</b> SIGN IN" />
      <main className="post-article">
        <p>{isWaiting ? "Completing your sign in..." : auth.error || "Redirecting you to your account..."}</p>
        {!isWaiting && auth.error ? (
          <p>
            Return to <a href="/auth">the auth page</a> and try again after checking your provider setup.
          </p>
        ) : null}
      </main>
    </Shell>
  );
}

function AdminAccessPanel({
  currentAdminId,
  error,
  loading,
  profiles,
  savingUserId,
  onChangeRole,
}) {
  return (
    <section className="auth-card auth-admin-panel">
      <h2>Admin Access Control</h2>
      <p className="auth-account-meta">
        Manage who stays a visitor, becomes a member, or gets full admin access.
      </p>
      {error ? <p className="engagement-error">{error}</p> : null}
      {loading ? <p>Loading members...</p> : null}
      {!loading && !profiles.length ? <p>No signed-in users are available yet.</p> : null}
      <div className="auth-admin-list">
        {profiles.map((entry) => {
          const isSaving = savingUserId === entry.userId;
          const isSelf = entry.userId === currentAdminId;

          return (
            <article key={entry.userId} className="auth-admin-item">
              <div>
                <strong>{entry.displayName}</strong>
                <p>{entry.email}</p>
                <p>
                  Current role: {entry.role} | Requested: {entry.requestedRole}
                </p>
              </div>
              <label className="auth-admin-role-field">
                <span>Access</span>
                <select
                  value={entry.role}
                  disabled={isSaving || isSelf}
                  onChange={(event) => onChangeRole(entry.userId, event.target.value)}
                >
                  <option value="visitor">Visitor</option>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
            </article>
          );
        })}
      </div>
      <p className="auth-account-meta">
        <code>dexteritycoder@gmail.com</code> is always treated as a default admin account.
      </p>
    </section>
  );
}

function ContentPreviewModal({ item, open, onClose, onApprove, onReject, busy }) {
  if (!open || !item) {
    return null;
  }

  return (
    <div className="auth-modal-backdrop" role="dialog" aria-modal="true" aria-label="Content preview">
      <div className="auth-modal-card cms-modal-card">
        <h2>{item.title}</h2>
        <p className="auth-account-meta">{item.section} · {item.status}</p>
        <div
          className="post-content cms-preview-scroll"
          dangerouslySetInnerHTML={{ __html: markdownToHtml(item.markdown || "") }}
        ></div>
        <div className="auth-modal-actions">
          <button type="button" className="engagement-submit-btn" onClick={onApprove} disabled={busy}>
            {busy ? "Working..." : "Approve"}
          </button>
          <button type="button" className="engagement-like-btn" onClick={onReject} disabled={busy}>
            Reject
          </button>
          <button type="button" className="engagement-like-btn" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function AdminDashboardPanel({ dashboard, loading, error, onReviewComment, onReviewContent, busyKey }) {
  const [previewItem, setPreviewItem] = useState(null);
  const counts = deriveDashboardCounts(dashboard);

  return (
    <section className="auth-card auth-admin-panel">
      <h2>Admin Dashboard</h2>
      <div className="auth-account-grid auth-account-grid-stack">
        <div>
          <strong>Role requests</strong>
          <p>{counts.roleRequests}</p>
        </div>
        <div>
          <strong>Pending comments</strong>
          <p>{counts.comments}</p>
        </div>
        <div>
          <strong>Content requests</strong>
          <p>{counts.content}</p>
        </div>
      </div>
      {error ? <p className="engagement-error">{error}</p> : null}
      {loading ? <p>Loading dashboard...</p> : null}
      {!loading ? (
        <div className="auth-admin-list">
          <article className="auth-admin-item auth-admin-item-stack">
            <div>
              <strong>Admin Requests</strong>
              <p>People asking to become admins.</p>
            </div>
            <div className="cms-dashboard-list">
              {(dashboard?.roleRequests || []).map((entry) => (
                <div key={entry.userId} className="cms-dashboard-card">
                  <strong>{entry.displayName}</strong>
                  <p>{entry.email}</p>
                </div>
              ))}
              {(dashboard?.roleRequests || []).length === 0 ? <p>No pending admin requests.</p> : null}
            </div>
          </article>
          <article className="auth-admin-item auth-admin-item-stack">
            <div>
              <strong>Comment Moderation</strong>
              <p>Approve or reject public comments.</p>
            </div>
            <div className="cms-dashboard-list">
              {(dashboard?.comments || []).map((entry) => (
                <div key={entry.id} className="cms-dashboard-card">
                  <strong>{entry.authorName} on {entry.entityType}:{entry.entityId}</strong>
                  <p>{entry.message}</p>
                  <p>Status: {entry.status}</p>
                  <div className="cms-inline-actions">
                    <button type="button" className="engagement-submit-btn" disabled={busyKey === `comment:${entry.id}`} onClick={() => onReviewComment(entry.id, "approved")}>Approve</button>
                    <button type="button" className="engagement-like-btn" disabled={busyKey === `comment:${entry.id}`} onClick={() => onReviewComment(entry.id, "rejected")}>Reject</button>
                  </div>
                </div>
              ))}
              {(dashboard?.comments || []).length === 0 ? <p>No comments found.</p> : null}
            </div>
          </article>
          <article className="auth-admin-item auth-admin-item-stack">
            <div>
              <strong>Content Requests</strong>
              <p>Preview posts, projects, and page edits before publishing.</p>
            </div>
            <div className="cms-dashboard-list">
              {(dashboard?.allContent || []).map((entry) => (
                <div key={entry.id} className="cms-dashboard-card">
                  <strong>{entry.title}</strong>
                  <p>{entry.section} · {entry.requestKind} · {entry.status}</p>
                  <div className="cms-inline-actions">
                    <button type="button" className="engagement-submit-btn" onClick={() => setPreviewItem(entry)}>Preview</button>
                    <button type="button" className="engagement-submit-btn" disabled={busyKey === `content:${entry.id}`} onClick={() => onReviewContent(entry.id, "approved")}>Approve</button>
                    <button type="button" className="engagement-like-btn" disabled={busyKey === `content:${entry.id}`} onClick={() => onReviewContent(entry.id, "rejected")}>Reject</button>
                  </div>
                </div>
              ))}
              {(dashboard?.allContent || []).length === 0 ? <p>No content requests yet.</p> : null}
            </div>
          </article>
        </div>
      ) : null}
      <ContentPreviewModal
        item={previewItem}
        open={Boolean(previewItem)}
        onClose={() => setPreviewItem(null)}
        onApprove={() => previewItem ? onReviewContent(previewItem.id, "approved").then(() => setPreviewItem(null)) : null}
        onReject={() => previewItem ? onReviewContent(previewItem.id, "rejected").then(() => setPreviewItem(null)) : null}
        busy={busyKey === `content:${previewItem?.id || ""}`}
      />
    </section>
  );
}

function AccountPage({ siteData, auth, content }) {
  usePageSetup("Account | Dexteritycoder", "post-page");

  const profile = auth.profile || {
    displayName: auth.user?.email || "Member",
    email: auth.user?.email || "",
    role: "visitor",
    requestedRole: "visitor",
    authProvider: "email",
  };
  const [managedProfiles, setManagedProfiles] = useState([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [savingUserId, setSavingUserId] = useState("");
  const [dashboard, setDashboard] = useState(null);
  const [dashboardBusyKey, setDashboardBusyKey] = useState("");

  useEffect(() => {
    let active = true;

    async function loadAdminProfiles() {
      if (!auth.user || profile.role !== "admin") {
        setManagedProfiles([]);
        setDashboard(null);
        setAdminError("");
        setAdminLoading(false);
        return;
      }

      setAdminLoading(true);
      try {
        const [profiles, dashboardData] = await Promise.all([
          fetchAdminProfiles(),
          fetchAdminDashboard(),
        ]);
        if (!active) {
          return;
        }
        setManagedProfiles(Array.isArray(profiles) ? profiles : []);
        setDashboard(dashboardData || null);
        setAdminError("");
      } catch (loadError) {
        if (!active) {
          return;
        }
        setAdminError(loadError.message || "Could not load admin profiles.");
      } finally {
        if (active) {
          setAdminLoading(false);
        }
      }
    }

    loadAdminProfiles();

    return () => {
      active = false;
    };
  }, [auth.user?.id, profile.role]);

  if (auth.loading) {
    return (
      <Shell siteData={siteData} auth={auth}>
        <Hero titleHtml="<b>ACCOUNT</b>" />
        <main className="post-article"><p>Loading your account...</p></main>
      </Shell>
    );
  }

  if (!auth.user) {
    return <Navigate to="/auth" replace />;
  }

  const roleCards = {
    admin: [
      "Read, write, update, and delete permissions",
      "Admin panel foundation for site stats and moderation",
      "Future blog/article publishing controls",
    ],
    member: [
      "Member dashboard foundation",
      "Future content submission workflow for admin review",
      "Future suggestions and notifications flow",
    ],
    visitor: [
      "Saved likes and comments through your account",
      "Newsletter subscription enabled by default",
      "Profile-based engagement and future saved activity history",
    ],
  };

  async function handleRoleChange(userId, role) {
    setSavingUserId(userId);
    setAdminError("");

    try {
      const response = await updateAdminProfileRole({ userId, role });
      if (Array.isArray(response?.profiles)) {
        setManagedProfiles(response.profiles);
      } else {
        const profiles = await fetchAdminProfiles();
        setManagedProfiles(Array.isArray(profiles) ? profiles : []);
      }
      await auth.refreshProfile().catch(() => null);
      auth.setNotice("Admin access updated.");
    } catch (updateError) {
      setAdminError(updateError.message || "Could not update that user.");
    } finally {
      setSavingUserId("");
    }
  }

  async function handleReviewComment(commentId, status) {
    setDashboardBusyKey(`comment:${commentId}`);
    setAdminError("");

    try {
      await reviewCommentRequest({ commentId, status });
      const dashboardData = await fetchAdminDashboard();
      setDashboard(dashboardData || null);
      await auth.refreshProfile().catch(() => null);
      auth.setNotice("Comment moderation updated.");
    } catch (updateError) {
      setAdminError(updateError.message || "Could not moderate that comment.");
    } finally {
      setDashboardBusyKey("");
    }
  }

  async function handleReviewContent(id, status) {
    setDashboardBusyKey(`content:${id}`);
    setAdminError("");

    try {
      await reviewContentRequest({ id, status });
      const dashboardData = await fetchAdminDashboard();
      setDashboard(dashboardData || null);
      await content.refresh();
      auth.setNotice("Content review updated.");
    } catch (updateError) {
      setAdminError(updateError.message || "Could not review that content.");
    } finally {
      setDashboardBusyKey("");
    }
  }

  return (
    <Shell siteData={siteData} auth={auth}>
      <Hero titleHtml="<b>YOUR</b> ACCOUNT" />
      <main className={`auth-page-shell${profile.role === "admin" ? " auth-page-shell-stack" : ""}`}>
        <section className="auth-card auth-profile-card">
          <h2>{profile.displayName}</h2>
          <p className="auth-account-meta">{profile.email}</p>
          <div className="auth-account-grid">
            <div>
              <strong>Role</strong>
              <p>{profile.role}</p>
            </div>
            <div>
              <strong>Requested role</strong>
              <p>{profile.requestedRole}</p>
            </div>
            <div>
              <strong>Provider</strong>
              <p>{profile.authProvider}</p>
            </div>
          </div>
          <div className="auth-dashboard-list">
            {roleCards[profile.role] ? roleCards[profile.role].map((item) => <p key={item}>{item}</p>) : null}
          </div>
          <button type="button" className="engagement-submit-btn" onClick={() => auth.signOutUser().catch(() => {})}>
            Log Out
          </button>
        </section>
        {profile.role === "admin" ? (
          <>
            <AdminDashboardPanel
              dashboard={dashboard}
              loading={adminLoading}
              error={adminError}
              onReviewComment={handleReviewComment}
              onReviewContent={handleReviewContent}
              busyKey={dashboardBusyKey}
            />
            <AdminAccessPanel
              currentAdminId={profile.userId}
              error={adminError}
              loading={adminLoading}
              profiles={managedProfiles}
              savingUserId={savingUserId}
              onChangeRole={handleRoleChange}
            />
          </>
        ) : null}
      </main>
    </Shell>
  );
}

function formatCommentDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Just now";
  }

  return date.toLocaleString();
}

function LegacyWritingRedirect() {
  const { blogId } = useParams();
  return <Navigate to={`/writings/${encodeURIComponent(blogId || "")}`} replace />;
}

function AppRoutes({ siteData, engagement, auth, content }) {
  return (
    <Routes>
      <Route path="/" element={<HomePage siteData={siteData} engagement={engagement} auth={auth} />} />
      <Route path="/index.html" element={<Navigate to="/" replace />} />
      <Route path="/works" element={<WorksPage siteData={siteData} engagement={engagement} auth={auth} />} />
      <Route path="/production-projects" element={<WorkMarkdownPage siteData={siteData} slug="production-projects" production engagement={engagement} auth={auth} content={content} />} />
      <Route path="/ai-machine-learning" element={<WorkMarkdownPage siteData={siteData} slug="ai-machine-learning" engagement={engagement} auth={auth} content={content} />} />
      <Route path="/train-to-thoughts" element={<WorkMarkdownPage siteData={siteData} slug="train-to-thoughts" engagement={engagement} auth={auth} content={content} />} />
      <Route path="/available-for-freelancing" element={<WorkMarkdownPage siteData={siteData} slug="available-for-freelancing" engagement={engagement} auth={auth} content={content} />} />
      <Route path="/about" element={<AboutPage siteData={siteData} auth={auth} content={content} />} />
      <Route path="/contact" element={<ContactPage siteData={siteData} auth={auth} />} />
      <Route path="/donate" element={<DonatePage siteData={siteData} auth={auth} />} />
      <Route path="/writings" element={<BlogListPage siteData={siteData} engagement={engagement} auth={auth} content={content} />} />
      <Route path="/writings/:blogId" element={<BlogDetailPage siteData={siteData} engagement={engagement} auth={auth} content={content} />} />
      <Route path="/auth" element={<AuthPage siteData={siteData} auth={auth} />} />
      <Route path="/auth/callback" element={<AuthCallbackPage siteData={siteData} auth={auth} />} />
      <Route path="/account" element={<AccountPage siteData={siteData} auth={auth} content={content} />} />
      <Route path="/blog" element={<Navigate to="/writings" replace />} />
      <Route path="/blog/:blogId" element={<LegacyWritingRedirect />} />
      <Route path="/project/:owner/:repo" element={<ProjectDetailPage siteData={siteData} engagement={engagement} auth={auth} content={content} />} />
      <Route path="/pages/blog.html" element={<Navigate to="/writings" replace />} />
      <Route path="/pages/production-projects.html" element={<Navigate to="/production-projects" replace />} />
      <Route path="/pages/ai-machine-learning.html" element={<Navigate to="/ai-machine-learning" replace />} />
      <Route path="/pages/train-to-thoughts.html" element={<Navigate to="/train-to-thoughts" replace />} />
      <Route path="/pages/available-for-freelancing.html" element={<Navigate to="/available-for-freelancing" replace />} />
      <Route path="/pages/about.html" element={<Navigate to="/about" replace />} />
      <Route path="/pages/contact.html" element={<Navigate to="/contact" replace />} />
      <Route path="/pages/donate.html" element={<Navigate to="/donate" replace />} />
      <Route path="/Blogs/blog-list.html" element={<Navigate to="/writings" replace />} />
      <Route path="/Blogs/blog-detail.html" element={<BlogDetailPage siteData={siteData} engagement={engagement} auth={auth} content={content} />} />
      <Route path="/pages/project-detail.html" element={<ProjectDetailPage siteData={siteData} engagement={engagement} auth={auth} content={content} />} />
      <Route path="/pages/post1.html" element={<Navigate to="/production-projects" replace />} />
      <Route path="/pages/post2.html" element={<Navigate to="/ai-machine-learning" replace />} />
      <Route path="/pages/post3.html" element={<Navigate to="/train-to-thoughts" replace />} />
      <Route path="/pages/post4.html" element={<Navigate to="/available-for-freelancing" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  const { data, error, loading } = useJson("/data/site-content.json");
  const auth = useSupabaseAuth();
  const engagement = useEngagement(auth);
  const content = useManagedContent();

  if (loading) {
    return <LoadingScreen />;
  }

  if (error || !data) {
    return (
      <main className="post-article">
        <p>Failed to load site data.</p>
      </main>
    );
  }

  return (
    <>
      <AppRoutes siteData={data} engagement={engagement} auth={auth} content={content} />
      <AuthPromptModal message={auth.promptMessage} onClose={auth.closeAuthPrompt} />
    </>
  );
}
