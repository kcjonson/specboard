/**
 * Auth handlers
 *
 * Re-exports all auth-related handlers from submodules.
 */

// Login
export { handleLogin } from './login.js';

// Signup
export { handleSignup } from './signup.js';

// Session (logout, getMe, updateMe)
export { handleLogout, handleGetMe, handleUpdateMe } from './session.js';

// Email verification
export { handleVerifyEmail, handleResendVerification } from './verification.js';

// Password (forgot, reset, change)
export { handleForgotPassword, handleResetPassword, handleChangePassword } from './password.js';
