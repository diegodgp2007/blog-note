import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

interface Note {
  id: string;
  title: string;
  content: string;
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
  readonly message = signal('');
  readonly filteredNotes = computed(() => {
    const query = this.search().trim().toLocaleLowerCase();
    return [...this.notes()]
      .filter((note) => !query || `${note.title} ${note.content}`.toLocaleLowerCase().includes(query))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });

  newNote(): void {
    this.selectedId.set(null);
    this.draftTitle.set('');
    this.draftContent.set('');
    this.message.set('');
  }

  selectNote(note: Note): void {
    this.selectedId.set(note.id);
    this.draftTitle.set(note.title);
    this.draftContent.set(note.content);
    this.message.set('');
  }

  saveNote(): void {
    const title = this.draftTitle().trim();
    const content = this.draftContent().trim();
    if (!title && !content) {
      this.message.set('Escribe un título o contenido antes de guardar.');
      return;
    }

    const id = this.selectedId() ?? (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`);
    const note: Note = { id, title: title || 'Nota sin título', content, updatedAt: new Date().toISOString() };
    const existing = this.notes().some((item) => item.id === id);
    const next = existing
      ? this.notes().map((item) => (item.id === id ? note : item))
      : [note, ...this.notes()];

    try {
      this.persist(next);
      this.selectedId.set(id);
      this.message.set('Guardado');
    } catch {
      this.message.set('No se pudo guardar. Revisa el almacenamiento disponible en el navegador.');
    }
  }

  deleteNote(): void {
    const id = this.selectedId();
    if (!id || !this.isBrowser || !globalThis.confirm('¿Eliminar esta nota? Esta acción no se puede deshacer.')) return;
    const next = this.notes().filter((note) => note.id !== id);
    try {
      this.persist(next);
      this.newNote();
    } catch {
      this.message.set('No se pudo eliminar la nota. Inténtalo de nuevo.');
    }
  }

  formattedDate(value: string): string {
    return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  }

  private loadNotes(): Note[] {
    if (!this.isBrowser) return [];
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
      return Array.isArray(saved) ? (saved as Note[]) : [];
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
