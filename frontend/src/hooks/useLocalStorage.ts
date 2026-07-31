import { useState, useEffect, useCallback } from 'react';

/**
 * Generic TypeScript hook for persisting state to localStorage
 * 
 * Features:
 * - Automatically persists to localStorage on change
 * - Gracefully handles JSON.parse errors (fallback to default)
 * - Syncs across browser tabs/windows via storage events
 * - Type-safe with full TypeScript support
 * 
 * @template T - The type of value to persist
 * @param key - The localStorage key
 * @param defaultValue - The default value if localStorage is empty or corrupted
 * @returns [value, setValue] - Current value and setter function
 * 
 * @example
 * const [status, setStatus] = useLocalStorage<'all' | 'open'>('statusFilter', 'all');
 * const [count, setCount] = useLocalStorage<number>('counter', 0);
 */
export function useLocalStorage<T>(
  key: string,
  defaultValue: T
): [T, (value: T | ((prev: T) => T)) => void] {
  // Initialize state from localStorage or use default
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      if (item === null) {
        return defaultValue;
      }
      return JSON.parse(item) as T;
    } catch (error) {
      // Log error for debugging but don't throw
      console.error(`Failed to parse localStorage key "${key}":`, error);
      return defaultValue;
    }
  });

  // Update localStorage when state changes
  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      try {
        // Allow value to be a function for functional updates (like useState)
        const valueToStore = value instanceof Function ? value(storedValue) : value;
        
        setStoredValue(valueToStore);
        
        // Persist to localStorage
        window.localStorage.setItem(key, JSON.stringify(valueToStore));
      } catch (error) {
        console.error(`Failed to set localStorage key "${key}":`, error);
      }
    },
    [key, storedValue]
  );

  // Sync state across tabs/windows
  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      // Only respond to changes for this specific key
      if (event.key !== key) {
        return;
      }

      try {
        if (event.newValue === null) {
          // Item was removed from localStorage
          setStoredValue(defaultValue);
        } else {
          // Item was updated in another tab
          setStoredValue(JSON.parse(event.newValue) as T);
        }
      } catch (error) {
        console.error(`Failed to sync localStorage key "${key}" from another tab:`, error);
        setStoredValue(defaultValue);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [key, defaultValue]);

  return [storedValue, setValue];
}
