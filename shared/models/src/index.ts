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
export { Collection } from './Collection';

// Hooks
export { useModel } from './hooks';

// Utilities
export { compileUrl } from './url-template';

// Types
export type { ChangeCallback, ModelMeta, ModelData, Observable } from './types';
export type { ModelConstructor } from './Collection';
