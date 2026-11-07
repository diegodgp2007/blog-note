import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  updatedAt: string;
}

const STORAGE_KEY = 'blog-notas.notes';

@Component({
  selector: 'app-root',
  imports: [FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly notes = signal<Note[]>(this.loadNotes());
  readonly search = signal('');
  readonly selectedId = signal<string | null>(null);
  readonly selectedNote = computed(() => this.notes().find((note) => note.id === this.selectedId()) ?? null);
  readonly draftTitle = signal('');
  readonly draftContent = signal('');
  readonly draftTags = signal('');
  readonly message = signal('');
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly hasUnsavedChanges = computed(() => {
    const saved = this.selectedNote();
    const title = this.draftTitle().trim() || 'Nota sin título';
    const content = this.draftContent().trim();
    const tags = [...new Set(this.draftTags().split(',').map((tag) => tag.trim()).filter(Boolean))];
    if (!this.selectedId()) return Boolean(this.draftTitle().trim() || content || tags.length);
    return !saved || saved.title !== title || saved.content !== content || saved.tags.join('|') !== tags.join('|');
  });
  readonly filteredNotes = computed(() => {
    const query = this.search().trim().toLocaleLowerCase();
    return [...this.notes()]
      .filter((note) => !query || `${note.title} ${note.content} ${note.tags.join(' ')}`.toLocaleLowerCase().includes(query))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });

  newNote(): void {
    if (!this.confirmDiscardIfDirty()) return;
    this.selectedId.set(null);
    this.draftTitle.set('');
    this.draftContent.set('');
    this.draftTags.set('');
    this.message.set('');
  }

  updateDraft(field: 'title' | 'content' | 'tags', value: string): void {
    if (field === 'title') this.draftTitle.set(value);
    if (field === 'content') this.draftContent.set(value);
    if (field === 'tags') this.draftTags.set(value);
    this.message.set('Cambios pendientes…');
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNote(true), 700);
  }

  selectNote(note: Note): void {
    if (note.id === this.selectedId()) return;
    if (!this.confirmDiscardIfDirty()) return;
    this.selectedId.set(note.id);
    this.draftTitle.set(note.title);
    this.draftContent.set(note.content);
    this.draftTags.set(note.tags.join(', '));
    this.message.set('');
  }

  saveNote(automatic = false): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const title = this.draftTitle().trim();
    const content = this.draftContent().trim();
    const tags = [...new Set(this.draftTags().split(',').map((tag) => tag.trim()).filter(Boolean))];
    if (!title && !content && !tags.length) {
      if (!automatic) this.message.set('Escribe un título, contenido o etiqueta antes de guardar.');
      return;
    }

    const id = this.selectedId() ?? (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`);
    const note: Note = { id, title: title || 'Nota sin título', content, tags, updatedAt: new Date().toISOString() };
    const existing = this.notes().some((item) => item.id === id);
    const next = existing
      ? this.notes().map((item) => (item.id === id ? note : item))
      : [note, ...this.notes()];

    try {
      this.persist(next);
      this.selectedId.set(id);
      this.message.set(automatic ? 'Guardado automáticamente' : 'Guardado');
    } catch {
      this.message.set('No se pudo guardar. Revisa el almacenamiento disponible en el navegador.');
    }
  }

  deleteNote(): void {
    const id = this.selectedId();
    if (!id || !this.isBrowser || !globalThis.confirm('¿Eliminar esta nota? Esta acción no se puede deshacer.')) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const next = this.notes().filter((note) => note.id !== id);
    try {
      this.persist(next);
      this.selectedId.set(null);
      this.draftTitle.set('');
      this.draftContent.set('');
      this.draftTags.set('');
      this.message.set('Nota eliminada');
    } catch {
      this.message.set('No se pudo eliminar la nota. Inténtalo de nuevo.');
    }
  }

  formattedDate(value: string): string {
    return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  }

  exportBackup(): void {
    if (!this.isBrowser) return;
    try {
      const file = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), notes: this.notes() }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(file);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `bloc-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      this.message.set('Respaldo descargado');
    } catch {
      this.message.set('No se pudo crear el respaldo.');
    }
  }

  importBackup(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !this.isBrowser) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed: unknown = JSON.parse(String(reader.result));
        const candidate = Array.isArray(parsed) ? parsed : (parsed as { notes?: unknown })?.notes;
        if (!Array.isArray(candidate) || !candidate.every((note) => this.isValidNote(note))) {
          throw new Error('El archivo no tiene un formato de respaldo válido.');
        }
        const combined = new Map<string, Note>(this.notes().map((note) => [note.id, note] as const));
        for (const rawNote of candidate as Note[]) combined.set(rawNote.id, rawNote);
        this.persist([...combined.values()]);
        this.message.set(`Respaldo importado: ${candidate.length} nota(s) combinada(s).`);
      } catch {
        this.message.set('No se pudo importar: el archivo no es un respaldo válido.');
      } finally {
        input.value = '';
      }
    };
    reader.onerror = () => {
      this.message.set('No se pudo leer el archivo de respaldo.');
      input.value = '';
    };
    reader.readAsText(file);
  }

  private isValidNote(value: unknown): value is Note {
    if (!value || typeof value !== 'object') return false;
    const note = value as Partial<Note>;
    return typeof note.id === 'string' && typeof note.title === 'string' && typeof note.content === 'string' &&
      typeof note.updatedAt === 'string' && Array.isArray(note.tags) && note.tags.every((tag) => typeof tag === 'string');
  }

  private confirmDiscardIfDirty(): boolean {
    if (this.hasUnsavedChanges() && this.isBrowser && !globalThis.confirm('Hay cambios que todavía no se han guardado. ¿Quieres descartarlos?')) return false;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    return true;
  }

  private loadNotes(): Note[] {
    if (!this.isBrowser) return [];
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
      return Array.isArray(saved) ? saved.map((note) => ({ ...(note as Note), tags: Array.isArray((note as Note).tags) ? (note as Note).tags : [] })).filter((note) => this.isValidNote(note)) : [];
    } catch {
      return [];
    }
  }

  private persist(notes: Note[]): void {
    if (!this.isBrowser) throw new Error('El almacenamiento solo está disponible en el navegador.');
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
    this.notes.set(notes);
  }
}
