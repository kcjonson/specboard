/**
 * @doc-platform/models
 *
 * State management with Model, SyncModel, and Collection classes.
 */

// Decorators
export { prop } from './prop';
export { collection } from './collection-decorator';
export { model } from './model-decorator';

// Classes
export { Model } from './Model';
export { SyncModel } from './SyncModel';
export { createCollection } from './Collection';
export type { Collection } from './Collection';
export { SyncCollection } from './SyncCollection';
export type { CollectionMeta } from './SyncCollection';

// Hooks
export { useModel } from './hooks';

// Utilities
export { compileUrl } from './url-template';

// Types
export type { ChangeCallback, ModelMeta, ModelData, Observable } from './types';
export type { ModelConstructor } from './Collection';

// Planning models
export { TaskModel, EpicModel, EpicsCollection } from './planning';
export type { Status, TaskStats } from './planning';

// Document models
export { DocumentModel, EMPTY_DOCUMENT } from './DocumentModel';
export type { SlateContent, DocumentComment } from './DocumentModel';

// Document persistence (localStorage crash recovery)
export {
	saveToLocalStorage,
	loadFromLocalStorage,
	hasPersistedContent,
	clearLocalStorage,
	getPersistedTimestamp,
} from './documentPersistence';
export type { LoadedPersistedDocument } from './documentPersistence';

// Authorization models
export { AuthorizationModel, AuthorizationsCollection } from './authorization';

// User model
export { UserModel } from './user';

// File browser model
export { FileTreeModel } from './FileTreeModel';
export type { FileEntry, PendingNewFile } from './FileTreeModel';

// Git status model
export { GitStatusModel } from './GitStatusModel';
export type { ChangedFile, CommitError } from './GitStatusModel';
