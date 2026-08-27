Below is a **stand‑alone, production‑ready** implementation of the requested kanban board in `frontend/src/App.tsx`.  
It uses **react‑beautiful‑dnd** (a lightweight, well‑maintained DnD library) and enforces the contract‑defined lifecycle transitions.  
All state changes are optimistic; if the backend call fails the UI rolls back and an explanatory message is shown.

```tsx
/* frontend/src/App.tsx */
import React, { useEffect, useState, useCallback } from 'react';
import {
  DragDropContext,
  Droppable,
  Draggable,
  DropResult,
} from 'react-beautiful-dnd';
import { updateBountyStatus } from './api'; // <-- your backend helper
import './App.css'; // optional styling

/* -------------------------------------------------------------------------- */
/* Types                                                                    */
/* -------------------------------------------------------------------------- */
export type BountyStatus = 'Open' | 'Reserved' | 'Submitted' | 'Released