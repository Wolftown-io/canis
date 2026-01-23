/**
 * E2EE Store
 *
 * Manages end-to-end encryption state including initialization status,
 * device/identity keys, and encryption/decryption operations.
 */

import { createSignal } from "solid-js";
import {
  getE2EEStatus,
  initE2EE,
  encryptMessage,
  decryptMessage,
  markPrekeysPublished,
  generatePrekeys,
  needsPrekeyUpload,
} from "@/lib/tauri";
import type {
  E2EEStatus,
  InitE2EEResponse,
  ClaimedPrekeyInput,
  E2EEContent,
  PrekeyData,
} from "@/lib/types";

// Reactive state
const [status, setStatus] = createSignal<E2EEStatus>({
  initialized: false,
  device_id: null,
  has_identity_keys: false,
});

const [isInitializing, setIsInitializing] = createSignal(false);
const [error, setError] = createSignal<string | null>(null);

// Functions

/**
 * Check current E2EE status from Tauri.
 */
async function checkStatus(): Promise<E2EEStatus> {
  try {
    const s = await getE2EEStatus();
    setStatus(s);
    setError(null);
    return s;
  } catch (e) {
    setError(String(e));
    throw e;
  }
}

/**
 * Initialize E2EE with the given encryption key.
 * Returns the identity keys and prekeys for server upload.
 */
async function initialize(encryptionKey: string): Promise<InitE2EEResponse> {
  setIsInitializing(true);
  setError(null);
  try {
    const response = await initE2EE(encryptionKey);
    await checkStatus();
    return response;
  } catch (e) {
    setError(String(e));
    throw e;
  } finally {
    setIsInitializing(false);
  }
}

/**
 * Encrypt a message for the given recipients.
 */
async function encrypt(
  plaintext: string,
  recipients: ClaimedPrekeyInput[]
): Promise<E2EEContent> {
  if (!status().initialized) {
    throw new Error("E2EE not initialized");
  }
  try {
    return await encryptMessage(plaintext, recipients);
  } catch (e) {
    setError(String(e));
    throw e;
  }
}

/**
 * Decrypt a message from a sender.
 */
async function decrypt(
  senderUserId: string,
  senderKey: string,
  messageType: number,
  ciphertext: string
): Promise<string> {
  if (!status().initialized) {
    throw new Error("E2EE not initialized");
  }
  try {
    return await decryptMessage(senderUserId, senderKey, messageType, ciphertext);
  } catch (e) {
    setError(String(e));
    throw e;
  }
}

/**
 * Generate additional prekeys.
 */
async function generateMorePrekeys(count: number): Promise<PrekeyData[]> {
  if (!status().initialized) {
    throw new Error("E2EE not initialized");
  }
  try {
    return await generatePrekeys(count);
  } catch (e) {
    setError(String(e));
    throw e;
  }
}

/**
 * Check if prekeys need to be uploaded.
 */
async function checkNeedsPrekeyUpload(): Promise<boolean> {
  if (!status().initialized) {
    return false;
  }
  try {
    return await needsPrekeyUpload();
  } catch (e) {
    setError(String(e));
    throw e;
  }
}

/**
 * Mark prekeys as published after server upload.
 */
async function markAsPublished(): Promise<void> {
  try {
    await markPrekeysPublished();
  } catch (e) {
    setError(String(e));
    throw e;
  }
}

/**
 * Clear any E2EE errors.
 */
function clearError(): void {
  setError(null);
}

// Export the store
export const e2eeStore = {
  // Reactive getters
  status,
  isInitializing,
  error,

  // Functions
  checkStatus,
  initialize,
  encrypt,
  decrypt,
  generateMorePrekeys,
  checkNeedsPrekeyUpload,
  markAsPublished,
  clearError,
};

// Also export individual signals and functions for direct access
export {
  status as e2eeStatus,
  isInitializing as e2eeIsInitializing,
  error as e2eeError,
  checkStatus as checkE2EEStatus,
  initialize as initializeE2EE,
  encrypt as encryptE2EE,
  decrypt as decryptE2EE,
  generateMorePrekeys,
  checkNeedsPrekeyUpload,
  markAsPublished as markPrekeysAsPublished,
  clearError as clearE2EEError,
};
