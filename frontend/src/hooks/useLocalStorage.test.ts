import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLocalStorage } from './useLocalStorage';

describe('useLocalStorage', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('Basic functionality', () => {
    it('should initialize with default value when localStorage is empty', () => {
      const { result } = renderHook(() => useLocalStorage('test-key', 'default'));
      expect(result.current[0]).toBe('default');
    });

    it('should initialize with stored value from localStorage', () => {
      localStorage.setItem('test-key', JSON.stringify('stored-value'));
      const { result } = renderHook(() => useLocalStorage('test-key', 'default'));
      expect(result.current[0]).toBe('stored-value');
    });

    it('should persist value to localStorage on update', () => {
      const { result } = renderHook(() => useLocalStorage('test-key', 'initial'));
      
      act(() => {
        result.current[1]('updated');
      });

      expect(result.current[0]).toBe('updated');
      expect(localStorage.getItem('test-key')).toBe(JSON.stringify('updated'));
    });

    it('should support functional updates like useState', () => {
      const { result } = renderHook(() => useLocalStorage('counter', 0));
      
      act(() => {
        result.current[1]((prev) => prev + 1);
      });

      expect(result.current[0]).toBe(1);
      
      act(() => {
        result.current[1]((prev) => prev + 5);
      });

      expect(result.current[0]).toBe(6);
    });
  });

  describe('Type support', () => {
    it('should handle string values', () => {
      const { result } = renderHook(() => useLocalStorage<string>('str-key', 'default'));
      
      act(() => {
        result.current[1]('new-string');
      });

      expect(result.current[0]).toBe('new-string');
      expect(localStorage.getItem('str-key')).toBe(JSON.stringify('new-string'));
    });

    it('should handle number values', () => {
      const { result } = renderHook(() => useLocalStorage<number>('num-key', 42));
      
      act(() => {
        result.current[1](100);
      });

      expect(result.current[0]).toBe(100);
      expect(localStorage.getItem('num-key')).toBe(JSON.stringify(100));
    });

    it('should handle boolean values', () => {
      const { result } = renderHook(() => useLocalStorage<boolean>('bool-key', false));
      
      act(() => {
        result.current[1](true);
      });

      expect(result.current[0]).toBe(true);
      expect(localStorage.getItem('bool-key')).toBe(JSON.stringify(true));
    });

    it('should handle object values', () => {
      const defaultObj = { status: 'all', minReward: '' };
      const { result } = renderHook(() => useLocalStorage('obj-key', defaultObj));
      
      const newObj = { status: 'open', minReward: '100' };
      act(() => {
        result.current[1](newObj);
      });

      expect(result.current[0]).toEqual(newObj);
      expect(localStorage.getItem('obj-key')).toBe(JSON.stringify(newObj));
    });

    it('should handle array values', () => {
      const { result } = renderHook(() => useLocalStorage<string[]>('arr-key', []));
      
      act(() => {
        result.current[1](['item1', 'item2']);
      });

      expect(result.current[0]).toEqual(['item1', 'item2']);
      expect(localStorage.getItem('arr-key')).toBe(JSON.stringify(['item1', 'item2']));
    });

    it('should handle union types (like filter states)', () => {
      type Status = 'all' | 'open' | 'reserved';
      const { result } = renderHook(() => useLocalStorage<Status>('status-key', 'all'));
      
      act(() => {
        result.current[1]('open');
      });

      expect(result.current[0]).toBe('open');
      
      act(() => {
        result.current[1]('reserved');
      });

      expect(result.current[0]).toBe('reserved');
    });
  });

  describe('Error handling', () => {
    it('should fallback to default value on JSON.parse error', () => {
      // Store invalid JSON
      localStorage.setItem('bad-json', 'not valid json {]');
      
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { result } = renderHook(() => useLocalStorage('bad-json', 'default'));
      
      expect(result.current[0]).toBe('default');
      expect(consoleSpy).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    it('should handle corrupted object data gracefully', () => {
      // Store corrupted data
      localStorage.setItem('corrupted', '{invalid json}');
      
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { result } = renderHook(() => useLocalStorage('corrupted', { status: 'all' }));
      
      expect(result.current[0]).toEqual({ status: 'all' });
      expect(consoleSpy).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    it('should log error when localStorage.setItem fails', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      // Mock localStorage.setItem to throw
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      const { result } = renderHook(() => useLocalStorage('test-key', 'initial'));
      
      act(() => {
        result.current[1]('updated');
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to set localStorage key'),
        expect.any(Error)
      );

      setItemSpy.mockRestore();
      consoleSpy.mockRestore();
    });
  });

  describe('Cross-tab synchronization', () => {
    it('should sync value when storage event fires from another tab', () => {
      const { result } = renderHook(() => useLocalStorage('sync-key', 'initial'));
      expect(result.current[0]).toBe('initial');

      // Simulate storage change from another tab
      act(() => {
        const event = new StorageEvent('storage', {
          key: 'sync-key',
          newValue: JSON.stringify('updated-from-other-tab'),
        });
        window.dispatchEvent(event);
      });

      expect(result.current[0]).toBe('updated-from-other-tab');
    });

    it('should ignore storage events for different keys', () => {
      const { result } = renderHook(() => useLocalStorage('key-a', 'initial'));
      expect(result.current[0]).toBe('initial');

      // Simulate storage change for different key
      act(() => {
        const event = new StorageEvent('storage', {
          key: 'key-b',
          newValue: JSON.stringify('different-key-value'),
        });
        window.dispatchEvent(event);
      });

      // Should remain unchanged
      expect(result.current[0]).toBe('initial');
    });

    it('should fallback to default when item is removed from another tab', () => {
      localStorage.setItem('sync-key', JSON.stringify('stored'));
      const { result } = renderHook(() => useLocalStorage('sync-key', 'default'));
      expect(result.current[0]).toBe('stored');

      // Simulate item removal from another tab
      act(() => {
        const event = new StorageEvent('storage', {
          key: 'sync-key',
          newValue: null,
        });
        window.dispatchEvent(event);
      });

      expect(result.current[0]).toBe('default');
    });

    it('should handle corrupted data from another tab', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { result } = renderHook(() => useLocalStorage('sync-key', 'default'));

      // Simulate corrupted data from another tab
      act(() => {
        const event = new StorageEvent('storage', {
          key: 'sync-key',
          newValue: 'invalid json {]',
        });
        window.dispatchEvent(event);
      });

      expect(result.current[0]).toBe('default');
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should cleanup storage event listener on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
      const { unmount } = renderHook(() => useLocalStorage('test-key', 'default'));

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('storage', expect.any(Function));
      removeEventListenerSpy.mockRestore();
    });
  });

  describe('Complex filter state scenarios', () => {
    it('should handle filter state object with multiple properties', () => {
      interface FilterState {
        statusFilter: 'all' | 'open' | 'reserved';
        minReward: string;
        maxReward: string;
        sortOption: string;
      }

      const defaultFilters: FilterState = {
        statusFilter: 'all',
        minReward: '',
        maxReward: '',
        sortOption: 'newest',
      };

      const { result } = renderHook(() => useLocalStorage<FilterState>('filters', defaultFilters));

      const newFilters: FilterState = {
        statusFilter: 'open',
        minReward: '100',
        maxReward: '1000',
        sortOption: 'reward-high',
      };

      act(() => {
        result.current[1](newFilters);
      });

      expect(result.current[0]).toEqual(newFilters);
      expect(JSON.parse(localStorage.getItem('filters')!)).toEqual(newFilters);
    });

    it('should handle partial updates with functional setter', () => {
      interface FilterState {
        status: string;
        minReward: string;
      }

      const { result } = renderHook(() =>
        useLocalStorage<FilterState>('filters', { status: 'all', minReward: '' })
      );

      act(() => {
        result.current[1]((prev) => ({
          ...prev,
          status: 'open',
        }));
      });

      expect(result.current[0]).toEqual({ status: 'open', minReward: '' });
    });

    it('should persist multiple independent filter hooks', () => {
      const { result: statusResult } = renderHook(() =>
        useLocalStorage<'all' | 'open'>('statusFilter', 'all')
      );
      const { result: sortResult } = renderHook(() =>
        useLocalStorage<'newest' | 'oldest'>('sortOption', 'newest')
      );

      act(() => {
        statusResult.current[1]('open');
        sortResult.current[1]('oldest');
      });

      expect(statusResult.current[0]).toBe('open');
      expect(sortResult.current[0]).toBe('oldest');
      expect(localStorage.getItem('statusFilter')).toBe(JSON.stringify('open'));
      expect(localStorage.getItem('sortOption')).toBe(JSON.stringify('oldest'));
    });
  });

  describe('Edge cases', () => {
    it('should handle null as a valid value', () => {
      const { result } = renderHook(() => useLocalStorage<string | null>('nullable', null));
      expect(result.current[0]).toBe(null);

      act(() => {
        result.current[1]('value');
      });

      expect(result.current[0]).toBe('value');

      act(() => {
        result.current[1](null);
      });

      expect(result.current[0]).toBe(null);
    });

    it('should handle empty string as a valid value', () => {
      const { result } = renderHook(() => useLocalStorage('empty', ''));
      expect(result.current[0]).toBe('');

      act(() => {
        result.current[1]('not-empty');
      });

      expect(result.current[0]).toBe('not-empty');

      act(() => {
        result.current[1]('');
      });

      expect(result.current[0]).toBe('');
    });

    it('should handle zero as a valid value', () => {
      const { result } = renderHook(() => useLocalStorage('zero', 0));
      expect(result.current[0]).toBe(0);

      act(() => {
        result.current[1](42);
      });

      expect(result.current[0]).toBe(42);

      act(() => {
        result.current[1](0);
      });

      expect(result.current[0]).toBe(0);
    });

    it('should handle false as a valid value', () => {
      const { result } = renderHook(() => useLocalStorage('bool', false));
      expect(result.current[0]).toBe(false);

      act(() => {
        result.current[1](true);
      });

      expect(result.current[0]).toBe(true);

      act(() => {
        result.current[1](false);
      });

      expect(result.current[0]).toBe(false);
    });

    it('should handle deeply nested objects', () => {
      const deepObj = {
        level1: {
          level2: {
            level3: {
              value: 'deep',
            },
          },
        },
      };

      const { result } = renderHook(() => useLocalStorage('deep', deepObj));
      expect(result.current[0]).toEqual(deepObj);

      const newDeepObj = {
        level1: {
          level2: {
            level3: {
              value: 'updated',
            },
          },
        },
      };

      act(() => {
        result.current[1](newDeepObj);
      });

      expect(result.current[0]).toEqual(newDeepObj);
    });
  });
});
