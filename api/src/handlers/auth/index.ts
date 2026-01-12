/**
 * Auth handlers
 *
 * Re-exports all auth-related handlers from submodules.
 */

// Login
export { handleLogin } from './login.ts';

// Signup
export { handleSignup } from './signup.ts';

// Session (logout, getMe, updateMe)
export { handleLogout, handleGetMe, handleUpdateMe } from './session.ts';

// Email verification
export { handleVerifyEmail, handleResendVerification } from './verification.ts';

// Password (forgot, reset, change)
export { handleForgotPassword, handleResetPassword, handleChangePassword } from './password.ts';
