'use strict';

const CONFIG = {
  SETTINGS: {
    theme: 'auto',
    sound: true,
    haptic: true,
    hints: true,
    archiveDays: 2,
    defaultPriority: 'medium',
    confirmDelete: false,
    swipeThreshold: 90,
    animationSpeed: 'slow'
  },
  TIMERS: {
    IDLE_TIMEOUT: 3000,
    HINT_DISPLAY: 8000,
    TOAST_DURATION: 5000,
    POMODORO: 1500,
    DOUBLE_TAP_DELAY: 300,
    LONG_PRESS_DELAY: 500
  },
  STORAGE_KEYS: {
    TASKS: 'tasks',
    ANALYTICS: 'analytics',
    TEMPLATES: 'templates',
    HINTS: 'shownHints',
    LAST_RESET: 'lastReset',
    THEME: 'theme'
  },
  AUDIO: {
    NOTIFICATION: 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt',
    VOLUME: 0.3
  }
};

const HINTS = [
  'Swipe right to complete, swipe left to delete',
  'Double-tap task to edit quickly',
  'Long-press task for quick actions',
  'Click category chips to use them'
];

const DOM = {
  get: (id) => document.getElementById(id),
  getAll: (selector) => document.querySelectorAll(selector),
  create: (tag, className = '', html = '') => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (html) el.innerHTML = html;
    return el;
  }
};

const Storage = {
  get(key, defaultValue = null) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : defaultValue;
    } catch (e) {
      console.error(`Storage get error for key ${key}:`, e);
      return defaultValue;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error(`Storage set error for key ${key}:`, e);
      return false;
    }
  }
};

const Utils = {
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    const dateOnly = dateStr.split('T')[0];
    if (dateOnly === today) return 'Today';
    if (dateOnly === tomorrowStr) return 'Tomorrow';

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  },

  vibrate(pattern = 10) {
    if (CONFIG.SETTINGS.haptic && navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  },

  playSound() {
    if (!CONFIG.SETTINGS.sound) return;
    try {
      const audio = new Audio(CONFIG.AUDIO.NOTIFICATION);
      audio.volume = CONFIG.AUDIO.VOLUME;
      audio.play().catch(() => {});
    } catch (e) {
      console.error('Sound play error:', e);
    }
  }
};

const State = {
  tasks: [],
  analytics: { sessions: 0, completedToday: 0 },
  templates: [],
  shownHints: [],
  currentTheme: 'dark',

  filters: {
    search: '',
    current: 'all',
    category: '',
    priority: ''
  },

  ui: {
    deletedTask: null,
    editingTask: null,
    draggedTaskId: null
  },

  timers: {
    idle: null,
    toast: null,
    pomodoro: null
  },

  init() {
    this.tasks = Storage.get(CONFIG.STORAGE_KEYS.TASKS, []);
    this.analytics = Storage.get(CONFIG.STORAGE_KEYS.ANALYTICS, { sessions: 0, completedToday: 0 });
    this.templates = Storage.get(CONFIG.STORAGE_KEYS.TEMPLATES, []);
    this.shownHints = Storage.get(CONFIG.STORAGE_KEYS.HINTS, []);
    this.currentTheme = Storage.get(CONFIG.STORAGE_KEYS.THEME, 'dark');
  },

  save() {
    Storage.set(CONFIG.STORAGE_KEYS.TASKS, this.tasks);
    Storage.set(CONFIG.STORAGE_KEYS.ANALYTICS, this.analytics);
    Storage.set(CONFIG.STORAGE_KEYS.TEMPLATES, this.templates);
    Storage.set(CONFIG.STORAGE_KEYS.HINTS, this.shownHints);
    Storage.set(CONFIG.STORAGE_KEYS.THEME, this.currentTheme);
  },

  addTask(task) {
    this.tasks.unshift(task);
    this.reorderTasks();
    this.save();
  },

  removeTask(id) {
    this.tasks = this.tasks.filter(t => t.id !== id);
    this.save();
  },

  updateTask(id, updates) {
    const task = this.tasks.find(t => t.id === id);
    if (task) {
      Object.assign(task, updates);
      this.save();
    }
  },

  getTask(id) {
    return this.tasks.find(t => t.id === id);
  },

  reorderTasks() {
    this.tasks.forEach((task, index) => {
      task.order = index;
    });
  }
};

const TaskParser = {
  parse(text) {
    let taskText = text.trim();
    let priority = CONFIG.SETTINGS.defaultPriority;
    let category = '';
    let dueDate = '';
    let dueTime = '';

    const priorityMatch = taskText.match(/!(high|medium|low)/i);
    if (priorityMatch) {
      priority = priorityMatch[1].toLowerCase();
      taskText = taskText.replace(priorityMatch[0], '').trim();
    }

    const categoryMatch = taskText.match(/#(\w+)/);
    if (categoryMatch) {
      category = categoryMatch[1];
      taskText = taskText.replace(categoryMatch[0], '').trim();
    }

    const today = new Date();
    if (/\b(today)\b/i.test(taskText)) {
      dueDate = today.toISOString().split('T')[0];
      taskText = taskText.replace(/\b(today)\b/i, '').trim();
    } else if (/\b(tomorrow)\b/i.test(taskText)) {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      dueDate = tomorrow.toISOString().split('T')[0];
      taskText = taskText.replace(/\b(tomorrow)\b/i, '').trim();
    }

    const timeMatch = taskText.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1]);
      const minutes = timeMatch[2] || '00';
      const meridiem = timeMatch[3];

      if (meridiem) {
        const isPM = meridiem.toLowerCase() === 'pm';
        if (isPM && hours < 12) hours += 12;
        if (!isPM && hours === 12) hours = 0;
      }

      dueTime = `${hours.toString().padStart(2, '0')}:${minutes}`;
      taskText = taskText.replace(timeMatch[0], '').trim();
    }

    const weekMatch = taskText.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
    if (weekMatch) {
      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const targetDay = days.indexOf(weekMatch[1].toLowerCase());
      const currentDay = today.getDay();
      const daysUntil = (targetDay - currentDay + 7) % 7 || 7;
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() + daysUntil);
      dueDate = targetDate.toISOString().split('T')[0];
      taskText = taskText.replace(weekMatch[0], '').trim();
    }

    return {
      text: taskText,
      priority,
      category,
      dueDate,
      dueTime
    };
  },

  createTask(parsed) {
    return {
      id: Date.now(),
      text: parsed.text,
      done: false,
      priority: parsed.priority,
      category: parsed.category,
      dueDate: parsed.dueDate,
      dueTime: parsed.dueTime,
      recurring: false,
      recurrence: '',
      createdAt: new Date().toISOString(),
      completedAt: null,
      order: 0
    };
  }
};

const TaskFilter = {
  isOverdue(task) {
    if (!task.dueDate || task.done) return false;
    const now = new Date();
    const due = new Date(task.dueDate);
    if (task.dueTime) {
      const [hours, minutes] = task.dueTime.split(':');
      due.setHours(parseInt(hours), parseInt(minutes));
    }
    return due < now;
  },

  isToday(task) {
    if (!task.dueDate) return false;
    const today = new Date().toISOString().split('T')[0];
    return task.dueDate === today;
  },

  isThisWeek(task) {
    if (!task.dueDate) return false;
    const now = new Date();
    const due = new Date(task.dueDate);
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    return due >= now && due <= weekFromNow;
  },

  apply(tasks) {
    let filtered = [...tasks];
    const { current, category, priority, search } = State.filters;

    switch (current) {
      case 'today':
        filtered = filtered.filter(this.isToday);
        break;
      case 'week':
        filtered = filtered.filter(this.isThisWeek);
        break;
      case 'overdue':
        filtered = filtered.filter(this.isOverdue);
        break;
      case 'completed':
        filtered = filtered.filter(t => t.done);
        break;
      case 'all':
      default:
        filtered = filtered.filter(t => !t.done);
        break;
    }

    if (category) {
      filtered = filtered.filter(t => t.category === category);
    }

    if (priority) {
      filtered = filtered.filter(t => t.priority === priority);
    }

    if (search) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter(t => t.text.toLowerCase().includes(searchLower));
    }

    return filtered.sort((a, b) => a.order - b.order);
  }
};

const DragDropHandler = {
  draggedElement: null,

  init(taskElement, taskId) {
    const handle = taskElement.querySelector('.drag-handle');
    if (!handle) return;

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.enableDrag(taskElement);
    });

    taskElement.addEventListener('dragstart', (e) => this.onDragStart(e, taskId));
    taskElement.addEventListener('dragend', (e) => this.onDragEnd(e));
    taskElement.addEventListener('dragover', (e) => this.onDragOver(e, taskElement));
    taskElement.addEventListener('drop', (e) => this.onDrop(e));
  },

  enableDrag(element) {
    element.setAttribute('draggable', 'true');
    Utils.vibrate(5);

    setTimeout(() => {
      element.setAttribute('draggable', 'false');
    }, 100);
  },

  onDragStart(e, taskId) {
    this.draggedElement = e.currentTarget;
    State.ui.draggedTaskId = taskId;

    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.currentTarget.innerHTML);
    Utils.vibrate(10);
  },

  onDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    e.currentTarget.setAttribute('draggable', 'false');

    this.updateTaskOrder();
    this.draggedElement = null;
    State.ui.draggedTaskId = null;
    Utils.vibrate(20);
  },

  onDragOver(e, targetElement) {
    e.preventDefault();

    if (!this.draggedElement || targetElement === this.draggedElement) {
      return;
    }

    const rect = targetElement.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;

    if (e.clientY < midpoint) {
      targetElement.parentNode.insertBefore(this.draggedElement, targetElement);
    } else {
      targetElement.parentNode.insertBefore(this.draggedElement, targetElement.nextSibling);
    }
  },

  onDrop(e) {
    e.preventDefault();
    e.stopPropagation();
  },

  updateTaskOrder() {
    const taskElements = Array.from(DOM.getAll('.task'));
    const newOrder = taskElements.map(el => parseInt(el.dataset.id));

    State.tasks.forEach(task => {
      const newIndex = newOrder.indexOf(task.id);
      if (newIndex !== -1) {
        task.order = newIndex;
      }
    });

    State.save();
  }
};

const TaskRenderer = {
  createTaskElement(task, animate = false) {
    const div = DOM.create('div', `task ${animate ? 'task-fly' : ''} ${task.done ? 'done' : ''} ${TaskFilter.isOverdue(task) ? 'overdue' : ''}`);
    div.dataset.id = task.id;
    div.dataset.priority = task.priority;
    div.setAttribute('draggable', 'false');

    div.innerHTML = `
      <span class="drag-handle">
        <svg class="icon"><use href="#icon-drag"/></svg>
      </span>
      <div class="check"></div>
      <div class="task-content">
        <div class="task-header">
          <div class="text">${Utils.escapeHtml(task.text)}</div>
        </div>
        ${this.renderMeta(task)}
      </div>
      <div class="task-actions">
        <button class="task-btn edit">
          <svg class="icon"><use href="#icon-edit"/></svg>
        </button>
        <button class="task-btn delete">
          <svg class="icon"><use href="#icon-trash"/></svg>
        </button>
      </div>
    `;

    this.attachEventListeners(div, task.id);
    return div;
  },

  renderMeta(task) {
    if (!task.category && !task.dueDate && !task.recurring) return '';

    return `
      <div class="task-meta">
        ${task.category ? `<span class="tag category">#${task.category}</span>` : ''}
        ${task.dueDate ? `<span class="tag date ${TaskFilter.isOverdue(task) ? 'overdue' : ''}">${Utils.formatDate(task.dueDate)}${task.dueTime ? ' ' + task.dueTime : ''}</span>` : ''}
        ${task.recurring ? `<span class="tag">${task.recurrence}</span>` : ''}
      </div>
    `;
  },

  attachEventListeners(element, taskId) {
    const checkbox = element.querySelector('.check');
    checkbox.addEventListener('click', (e) => {
      e.stopPropagation();
      TaskActions.toggle(taskId);
    });

    const editBtn = element.querySelector('.edit');
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      TaskActions.quickEdit(taskId);
    });

    const deleteBtn = element.querySelector('.delete');
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      TaskActions.delete(taskId);
    });

    this.attachDoubleTap(element, taskId);
    this.attachLongPress(element, taskId);
    this.attachSwipeGestures(element, taskId);
    DragDropHandler.init(element, taskId);
  },

  attachDoubleTap(element, taskId) {
    const textEl = element.querySelector('.text');
    let tapCount = 0;
    let tapTimer = null;

    textEl.addEventListener('click', (e) => {
      e.stopPropagation();
      tapCount++;

      if (tapCount === 1) {
        tapTimer = setTimeout(() => {
          tapCount = 0;
        }, CONFIG.TIMERS.DOUBLE_TAP_DELAY);
      } else if (tapCount === 2) {
        clearTimeout(tapTimer);
        tapCount = 0;
        TaskActions.quickEdit(taskId);
        Utils.vibrate(15);
      }
    });
  },

  attachLongPress(element, taskId) {
    let longPressTimer = null;

    const startLongPress = (e) => {
      if (e.target.closest('.check') || e.target.closest('.task-btn') || e.target.closest('.drag-handle')) {
        return;
      }

      longPressTimer = setTimeout(() => {
        const touch = e.touches ? e.touches[0] : e;
        UI.showQuickActions(taskId, touch.clientX, touch.clientY);
      }, CONFIG.TIMERS.LONG_PRESS_DELAY);
    };

    const cancelLongPress = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };

    element.addEventListener('touchstart', startLongPress, { passive: true });
    element.addEventListener('touchend', cancelLongPress, { passive: true });
    element.addEventListener('touchmove', cancelLongPress, { passive: true });
    element.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      UI.showQuickActions(taskId, e.clientX, e.clientY);
    });
  },

  attachSwipeGestures(element, taskId) {
    let touchStartX = 0;
    let touchStartY = 0;
    let touchCurrentX = 0;
    let isSwiping = false;

    element.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchCurrentX = touchStartX;
      isSwiping = false;
      element.style.transition = 'none';
    }, { passive: true });

    element.addEventListener('touchmove', (e) => {
      touchCurrentX = e.touches[0].clientX;
      const deltaX = touchCurrentX - touchStartX;
      const deltaY = Math.abs(e.touches[0].clientY - touchStartY);

      if (Math.abs(deltaX) > 20 && deltaY < 50) {
        if (!isSwiping) {
          isSwiping = true;
          element.classList.add('swiping');
          DOM.get('swipe-hint').classList.add('show');
          Utils.vibrate(5);
        }

        e.preventDefault();
        element.style.transform = `translateX(${deltaX}px)`;
        element.style.opacity = Math.max(0.5, 1 - Math.abs(deltaX) / 300);
      }
    }, { passive: false });

    element.addEventListener('touchend', () => {
      DOM.get('swipe-hint').classList.remove('show');

      if (isSwiping) {
        const deltaX = touchCurrentX - touchStartX;
        element.classList.remove('swiping');
        element.style.transition = 'all 0.3s';

        if (Math.abs(deltaX) > CONFIG.SETTINGS.swipeThreshold) {
          element.style.transform = `translateX(${deltaX > 0 ? '100%' : '-100%'})`;
          element.style.opacity = '0';
          Utils.vibrate([10, 20]);

          setTimeout(() => {
            element.style.transform = '';
            element.style.opacity = '';
            element.style.transition = '';

            if (deltaX > 0) {
              TaskActions.toggle(taskId);
            } else {
              TaskActions.delete(taskId, true);
            }
          }, 300);
        } else {
          element.style.transform = '';
          element.style.opacity = '';
          setTimeout(() => {
            element.style.transition = '';
          }, 300);
        }
      }
    }, { passive: true });

    element.addEventListener('touchcancel', () => {
      DOM.get('swipe-hint').classList.remove('show');
      element.classList.remove('swiping');
      element.style.transform = '';
      element.style.opacity = '';
      element.style.transition = '';
    }, { passive: true });
  }
};

const TaskActions = {
  add() {
    const input = DOM.get('input');
    const text = input.value.trim();

    if (!text) {
      input.style.animation = 'shake .5s';
      Utils.vibrate([10, 50, 10]);
      setTimeout(() => {
        input.style.animation = '';
      }, 500);
      return;
    }

    const parsed = TaskParser.parse(text);
    const task = TaskParser.createTask(parsed);

    State.addTask(task);
    input.value = '';

    Utils.playSound();
    Utils.vibrate(20);

    const list = DOM.get('list');
    const existingEmpty = list.querySelector('.empty');
    if (existingEmpty) {
      list.innerHTML = '';
    }

    const taskEl = TaskRenderer.createTaskElement(task, true);
    list.insertBefore(taskEl, list.firstChild);

    UI.updateStats();
    UI.updateCategoryFilter();
    UI.updateQuickCategories();

    setTimeout(() => input.focus(), 100);
  },

  toggle(taskId) {
    const task = State.getTask(taskId);
    if (!task) return;

    task.done = !task.done;
    task.completedAt = task.done ? new Date().toISOString() : null;

    const taskEl = document.querySelector(`[data-id="${taskId}"]`);
    if (taskEl) {
      taskEl.classList.toggle('done', task.done);
    }

    if (task.done) {
      Utils.playSound();
      Utils.vibrate([10, 20, 10]);
      State.analytics.completedToday++;

      const remaining = State.tasks.filter(t => !t.done).length;
      if (remaining === 0) {
        setTimeout(() => {
          UI.showConfetti();
          Utils.vibrate([50, 100, 50]);
        }, 300);
      }
    }

    State.save();
    UI.updateStats();
    setTimeout(() => DOM.get('input').focus(), 300);
  },

  delete(taskId, skipUndo = false) {
    const task = State.getTask(taskId);
    if (!task) return;

    const index = State.tasks.findIndex(t => t.id === taskId);
    State.ui.deletedTask = { task: {...task}, index };

    State.removeTask(taskId);

    const taskEl = document.querySelector(`[data-id="${taskId}"]`);
    if (taskEl) {
      taskEl.style.animation = 'none';
      taskEl.style.transition = 'all 0.3s';
      taskEl.style.opacity = '0';
      taskEl.style.transform = 'translateX(-100%)';

      setTimeout(() => {
        taskEl.remove();
        UI.updateStats();
        UI.updateQuickCategories();
        UI.checkEmptyState();
      }, 300);
    }

    Utils.vibrate(20);
    Utils.playSound();

    if (!skipUndo) {
      UI.showToast('Task deleted', () => {
        State.tasks.splice(State.ui.deletedTask.index, 0, State.ui.deletedTask.task);
        State.save();
        UI.render();
      });
    }

    setTimeout(() => DOM.get('input').focus(), 300);
  },

  quickEdit(taskId) {
    const task = State.getTask(taskId);
    if (!task) return;

    const taskEl = document.querySelector(`[data-id="${taskId}"]`);
    if (!taskEl) return;

    const textEl = taskEl.querySelector('.text');
    const currentText = task.text;

    textEl.contentEditable = true;
    textEl.focus();
    textEl.style.cssText = 'background:rgba(99,102,241,.1);padding:4px 8px;border-radius:6px;outline:2px solid var(--accent)';

    const range = document.createRange();
    range.selectNodeContents(textEl);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    const saveEdit = () => {
      const newText = textEl.textContent.trim();
      if (newText && newText !== currentText) {
        State.updateTask(taskId, { text: newText });
      }
      textEl.contentEditable = false;
      textEl.style.cssText = '';
      textEl.textContent = State.getTask(taskId).text;
      Utils.vibrate(20);
      setTimeout(() => DOM.get('input').focus(), 100);
    };

    const cancelEdit = () => {
      textEl.contentEditable = false;
      textEl.style.cssText = '';
      textEl.textContent = currentText;
      setTimeout(() => DOM.get('input').focus(), 100);
    };

    const handleKeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveEdit();
        textEl.removeEventListener('blur', saveEdit);
        textEl.removeEventListener('keydown', handleKeydown);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
        textEl.removeEventListener('blur', saveEdit);
        textEl.removeEventListener('keydown', handleKeydown);
      }
    };

    textEl.addEventListener('blur', saveEdit, { once: true });
    textEl.addEventListener('keydown', handleKeydown);
  }
};

const UI = {
  init() {
    this.bindEvents();
    this.applyTheme();
    this.render();
    this.checkDailyReset();
    this.startIdleTimer();

    setTimeout(() => {
      DOM.get('input').focus();
    }, 500);
  },

  bindEvents() {
    DOM.get('add').addEventListener('click', () => TaskActions.add());
    DOM.get('input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') TaskActions.add();
    });

    DOM.get('search').addEventListener('input', Utils.debounce((e) => {
      State.filters.search = e.target.value;
      this.render();
    }, 300));

    DOM.getAll('.filter').forEach(btn => {
      btn.addEventListener('click', () => {
        DOM.getAll('.filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        State.filters.current = btn.dataset.filter;
        this.render();
        Utils.vibrate(5);
      });
    });

    DOM.get('category-filter').addEventListener('change', (e) => {
      State.filters.category = e.target.value;
      this.render();
    });

    DOM.get('priority-filter').addEventListener('change', (e) => {
      State.filters.priority = e.target.value;
      this.render();
    });

    DOM.get('theme').addEventListener('click', () => {
      this.toggleTheme();
      Utils.vibrate(5);
    });

    DOM.get('analytics').addEventListener('click', () => {
      this.showAnalytics();
      Utils.vibrate(5);
    });

    DOM.get('sort').addEventListener('click', () => {
      State.tasks.reverse();
      State.reorderTasks();
      State.save();
      this.render();
      Utils.vibrate(10);
    });

    DOM.getAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', () => {
        this.hideModal(btn.closest('.modal').id);
        Utils.vibrate(5);
      });
    });

    DOM.getAll('.modal').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this.hideModal(modal.id);
          Utils.vibrate(5);
        }
      });
    });

    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        DOM.get('search').focus();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        DOM.get('input').focus();
      }
      if (e.key === 'Escape') {
        DOM.getAll('.modal.show').forEach(m => this.hideModal(m.id));
        DOM.get('search').value = '';
        State.filters.search = '';
        this.render();
        setTimeout(() => DOM.get('input').focus(), 100);
      }
    });

    ['mousemove', 'touchstart', 'keydown'].forEach(event => {
      document.addEventListener(event, () => this.resetIdleTimer(), { passive: true });
    });
  },

  toggleTheme() {
    if (State.currentTheme === 'dark') {
      State.currentTheme = 'light';
    } else {
      State.currentTheme = 'dark';
    }
    State.save();
    this.applyTheme();
  },

  applyTheme() {
    document.body.setAttribute('data-theme', State.currentTheme);
    document.body.setAttribute('data-animation', CONFIG.SETTINGS.animationSpeed);
  },

  render() {
    const filtered = TaskFilter.apply(State.tasks);
    const list = DOM.get('list');

    this.updateStats();
    this.updateCategoryFilter();
    this.updateQuickCategories();

    if (!filtered.length) {
      this.checkEmptyState();
      return;
    }

    list.innerHTML = '';
    const fragment = document.createDocumentFragment();

    filtered.forEach(task => {
      fragment.appendChild(TaskRenderer.createTaskElement(task));
    });

    list.appendChild(fragment);
  },

  updateStats() {
    const total = State.tasks.length;
    const done = State.tasks.filter(t => t.done).length;
    const pending = total - done;
    const overdue = State.tasks.filter(TaskFilter.isOverdue).length;

    const statsEl = DOM.get('stats');
    if (total === 0) {
      statsEl.innerHTML = '';
      return;
    }

    const createStatSpan = (label, value, filter) => {
      const span = document.createElement('span');
      span.textContent = `${label}: ${value}`;
      span.style.cursor = 'pointer';
      if (filter === 'overdue' && overdue > 0) {
        span.style.color = 'var(--danger)';
      }
      span.addEventListener('click', () => {
        State.filters.current = filter;
        this.updateFilterButtons();
        this.render();
      });
      return span;
    };

    statsEl.innerHTML = '';
    statsEl.appendChild(createStatSpan('Total', total, 'all'));
    statsEl.appendChild(document.createTextNode(' '));
    statsEl.appendChild(createStatSpan('Done', done, 'completed'));
    statsEl.appendChild(document.createTextNode(' '));
    statsEl.appendChild(createStatSpan('Pending', pending, 'all'));

    if (overdue > 0) {
      statsEl.appendChild(document.createTextNode(' '));
      statsEl.appendChild(createStatSpan('Overdue', overdue, 'overdue'));
    }
  },

  updateFilterButtons() {
    DOM.getAll('.filter').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === State.filters.current);
    });
  },

  updateCategoryFilter() {
    const categories = [...new Set(State.tasks.map(t => t.category).filter(Boolean))];
    const select = DOM.get('category-filter');
    const current = select.value;

    select.innerHTML = '<option value="">All Categories</option>' + 
      categories.map(c => `<option value="${c}">${c}</option>`).join('');

    if (categories.includes(current)) {
      select.value = current;
    }
  },

  updateQuickCategories() {
    const categories = [...new Set(State.tasks.map(t => t.category).filter(Boolean))];
    const container = DOM.get('quick-categories');

    if (!categories.length) {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'flex';
    container.innerHTML = '';

    categories.slice(0, 5).forEach(category => {
      const btn = document.createElement('button');
      btn.className = 'quick-cat';
      btn.textContent = `#${category}`;
      btn.addEventListener('click', () => {
        DOM.get('input').value = `#${category} `;
        DOM.get('input').focus();
        Utils.vibrate(10);
      });
      container.appendChild(btn);
    });
  },

  checkEmptyState() {
    const list = DOM.get('list');
    const hasTasks = DOM.getAll('.task').length > 0;

    if (!hasTasks) {
      const hour = new Date().getHours();
      let suggestions = [];

      if (hour >= 5 && hour < 12) {
        suggestions = ['☕ Morning coffee', '📰 Check emails', '🏃 Morning exercise'];
      } else if (hour >= 12 && hour < 17) {
        suggestions = ['🍽️ Lunch break', '📞 Important calls', '💼 Meeting prep'];
      } else if (hour >= 17 && hour < 21) {
        suggestions = ['🍳 Dinner plans', '📚 Reading time', '🧘 Evening routine'];
      } else {
        suggestions = ['😴 Bedtime routine', '📝 Tomorrow planning', '🌙 Wind down'];
      }

      const suggestionHTML = suggestions.map(s => {
        return `<div style="padding:8px 12px;background:rgba(99,102,241,.1);border-radius:8px;margin:4px 0;cursor:pointer;font-size:13px" class="suggestion-item" data-text="${s}">${s}</div>`;
      }).join('');

      list.innerHTML = `<div class="empty">
        ${State.filters.search || State.filters.category || State.filters.priority ? 
          'No tasks found' : 
          `<p style="margin-bottom:16px">No tasks yet. Start by adding one!</p>
           <p style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">Quick suggestions:</p>
           ${suggestionHTML}`
        }
      </div>`;

      DOM.getAll('.suggestion-item').forEach(item => {
        item.addEventListener('click', () => {
          DOM.get('input').value = item.dataset.text;
          DOM.get('input').focus();
        });
      });
    }
  },

  showQuickActions(taskId, x, y) {
    const existing = document.querySelector('.quick-actions');
    if (existing) existing.remove();

    const task = State.getTask(taskId);
    if (!task) return;

    const menu = DOM.create('div', 'quick-actions');
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:var(--bg-card);border-radius:12px;padding:8px;box-shadow:var(--shadow-lg);z-index:999;border:1px solid rgba(255,255,255,.1);min-width:160px`;

    const actions = [
      { icon: 'check', label: task.done ? 'Undo' : 'Complete', action: () => TaskActions.toggle(taskId) },
      { icon: 'edit', label: 'Edit', action: () => TaskActions.quickEdit(taskId) },
      { icon: 'trash', label: 'Delete', action: () => TaskActions.delete(taskId) }
    ];

    actions.forEach(a => {
      const btn = DOM.create('button');
      btn.style.cssText = 'width:100%;padding:10px 12px;background:rgba(255,255,255,.05);border:none;border-radius:8px;color:var(--text-primary);cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:4px;transition:all 0.2s';
      btn.innerHTML = `<svg class="icon" style="width:16px;height:16px"><use href="#icon-${a.icon}"/></svg><span>${a.label}</span>`;
      btn.onmouseover = () => btn.style.background = 'var(--accent)';
      btn.onmouseout = () => btn.style.background = 'rgba(255,255,255,.05)';
      btn.onclick = () => {
        a.action();
        menu.remove();
        Utils.vibrate(10);
      };
      menu.appendChild(btn);
    });

    document.body.appendChild(menu);
    Utils.vibrate(20);

    setTimeout(() => {
      const closeMenu = (e) => {
        if (!menu.contains(e.target)) {
          menu.remove();
          document.removeEventListener('click', closeMenu);
        }
      };
      document.addEventListener('click', closeMenu);
    }, 100);
  },

  showToast(message, onUndo) {
    const toast = DOM.get('toast');
    const text = toast.querySelector('.toast-text');
    const undoBtn = toast.querySelector('.toast-undo');

    text.textContent = message;
    toast.classList.add('show');

    if (State.timers.toast) {
      clearTimeout(State.timers.toast);
    }

    undoBtn.onclick = () => {
      onUndo();
      this.hideToast();
      Utils.vibrate(20);
    };

    State.timers.toast = setTimeout(() => this.hideToast(), CONFIG.TIMERS.TOAST_DURATION);
  },

  hideToast() {
    DOM.get('toast').classList.remove('show');
    State.ui.deletedTask = null;
    if (State.timers.toast) {
      clearTimeout(State.timers.toast);
      State.timers.toast = null;
    }
  },

  showModal(id) {
    DOM.get(id).classList.add('show');
  },

  hideModal(id) {
    DOM.get(id).classList.remove('show');
    setTimeout(() => DOM.get('input').focus(), 100);
  },

  showAnalytics() {
    const completed = State.tasks.filter(t => t.done).length;
    const pending = State.tasks.filter(t => !t.done).length;
    const overdue = State.tasks.filter(TaskFilter.isOverdue).length;
    const byPriority = {
      high: State.tasks.filter(t => t.priority === 'high' && !t.done).length,
      medium: State.tasks.filter(t => t.priority === 'medium' && !t.done).length,
      low: State.tasks.filter(t => t.priority === 'low' && !t.done).length
    };

    DOM.get('analytics-content').innerHTML = `
      <div style="margin-bottom:24px">
        <h4 style="margin-bottom:12px;color:var(--text-secondary);font-size:13px">Overview</h4>
        <p style="margin:8px 0">Completed: ${completed}</p>
        <p style="margin:8px 0">Pending: ${pending}</p>
        <p style="margin:8px 0">Overdue: ${overdue}</p>
        <p style="margin:8px 0">Completed Today: ${State.analytics.completedToday}</p>
      </div>
      <div>
        <h4 style="margin-bottom:12px;color:var(--text-secondary);font-size:13px">By Priority</h4>
        <p style="margin:8px 0">High: ${byPriority.high}</p>
        <p style="margin:8px 0">Medium: ${byPriority.medium}</p>
        <p style="margin:8px 0">Low: ${byPriority.low}</p>
      </div>
    `;
    this.showModal('analytics-modal');
  },

  showConfetti() {
    const colors = ['#6366f1', '#a78bfa', '#10b981', '#f59e0b', '#ef4444'];
    for (let i = 0; i < 50; i++) {
      const piece = DOM.create('div');
      piece.style.cssText = `position:fixed;width:8px;height:8px;background:${colors[Math.floor(Math.random() * colors.length)]};left:${Math.random() * 100}%;top:-10px;border-radius:50%;pointer-events:none;z-index:9999`;
      document.body.appendChild(piece);

      const animation = piece.animate([
        { transform: 'translateY(0) rotate(0deg)', opacity: 1 },
        { transform: `translateY(${window.innerHeight + 50}px) rotate(${Math.random() * 720}deg)`, opacity: 0 }
      ], { 
        duration: 2000 + Math.random() * 1000, 
        easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' 
      });

      animation.onfinish = () => piece.remove();
    }
  },

  checkDailyReset() {
    const today = new Date().toISOString().split('T')[0];
    const lastReset = Storage.get(CONFIG.STORAGE_KEYS.LAST_RESET);

    if (lastReset !== today) {
      State.analytics.completedToday = 0;
      State.analytics.sessions = 0;
      Storage.set(CONFIG.STORAGE_KEYS.LAST_RESET, today);
      State.save();
    }
  },

  startIdleTimer() {
    this.resetIdleTimer();
  },

  resetIdleTimer() {
    if (State.timers.idle) {
      clearTimeout(State.timers.idle);
    }

    State.timers.idle = setTimeout(() => {
      const activeElement = document.activeElement;
      const isModalOpen = DOM.getAll('.modal.show').length > 0;

      if (!isModalOpen && activeElement.tagName !== 'INPUT' && activeElement.tagName !== 'TEXTAREA') {
        const input = DOM.get('input');
        input.focus();
        input.setAttribute('placeholder', '💡 Ready to add a task?');
        setTimeout(() => {
          input.setAttribute('placeholder', "Add a task... Try: 'Buy milk tomorrow #shopping !high'");
        }, 2000);
      }
    }, CONFIG.TIMERS.IDLE_TIMEOUT);
  }
};

document.addEventListener('DOMContentLoaded', () => {
  State.init();
  UI.init();
});
