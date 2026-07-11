import type { ProjectData } from "./types";

const PROJECT_LIBRARY_DB_NAME = "cyber-pingdou-project-library";
const PROJECT_LIBRARY_STORE_NAME = "projects";
const PROJECT_LIBRARY_DB_VERSION = 1;

export type SavedProjectRecord = ProjectData & {
  id: string;
  createdAt: string;
  thumbnailDataUrl?: string;
};

export type ProjectLibraryInput = ProjectData & {
  thumbnailDataUrl?: string;
};

const createProjectId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `project-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const openProjectLibraryDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(PROJECT_LIBRARY_DB_NAME, PROJECT_LIBRARY_DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROJECT_LIBRARY_STORE_NAME)) {
        const store = database.createObjectStore(PROJECT_LIBRARY_STORE_NAME, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const runProjectStore = async <Result>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<Result>
) => {
  const database = await openProjectLibraryDb();

  return new Promise<Result>((resolve, reject) => {
    const transaction = database.transaction(PROJECT_LIBRARY_STORE_NAME, mode);
    const store = transaction.objectStore(PROJECT_LIBRARY_STORE_NAME);
    const request = action(store);
    let isSettled = false;

    const finish = () => {
      database.close();
    };

    request.onsuccess = () => {
      isSettled = true;
      resolve(request.result);
    };
    request.onerror = () => {
      isSettled = true;
      reject(request.error);
    };
    transaction.oncomplete = finish;
    transaction.onerror = () => {
      finish();
      if (!isSettled) {
        reject(transaction.error);
      }
    };
    transaction.onabort = () => {
      finish();
      if (!isSettled) {
        reject(transaction.error);
      }
    };
  });
};

export const listSavedProjects = async () => {
  const projects = await runProjectStore<SavedProjectRecord[]>("readonly", (store) => store.getAll());
  return projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
};

export const getSavedProject = (id: string) =>
  runProjectStore<SavedProjectRecord | undefined>("readonly", (store) => store.get(id));

export const saveProjectToLibrary = async (project: ProjectLibraryInput, id?: string) => {
  const now = new Date().toISOString();
  const existingProject = id ? await getSavedProject(id) : undefined;
  const record: SavedProjectRecord = {
    ...project,
    id: id ?? createProjectId(),
    createdAt: existingProject?.createdAt ?? now,
    updatedAt: now
  };

  await runProjectStore<IDBValidKey>("readwrite", (store) => store.put(record));
  return record;
};

export const deleteSavedProject = (id: string) =>
  runProjectStore<undefined>("readwrite", (store) => store.delete(id));
