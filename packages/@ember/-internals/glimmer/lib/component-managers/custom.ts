import { ARGS_PROXY_TAGS, consume } from '@ember/-internals/metal';
import { Factory } from '@ember/-internals/owner';
import { HAS_NATIVE_PROXY } from '@ember/-internals/utils';
import { OwnedTemplateMeta } from '@ember/-internals/views';
import { EMBER_CUSTOM_COMPONENT_ARG_PROXY } from '@ember/canary-features';
import { assert } from '@ember/debug';
import { DEBUG } from '@glimmer/env';
import {
  ComponentCapabilities,
  Dict,
  Opaque,
  Option,
  ProgramSymbolTable,
} from '@glimmer/interfaces';
import { PathReference, Tag } from '@glimmer/reference';
import {
  Arguments,
  CapturedArguments,
  ComponentDefinition,
  Invocation,
  WithStaticLayout,
} from '@glimmer/runtime';
import { Destroyable } from '@glimmer/util';

import Environment from '../environment';
import RuntimeResolver from '../resolver';
import { OwnedTemplate } from '../template';
import { RootReference } from '../utils/references';
import AbstractComponentManager from './abstract';

const CAPABILITIES = {
  dynamicLayout: false,
  dynamicTag: false,
  prepareArgs: false,
  createArgs: true,
  attributeHook: false,
  elementHook: false,
  createCaller: false,
  dynamicScope: true,
  updateHook: true,
  createInstance: true,
};

export interface OptionalCapabilities {
  asyncLifecycleCallbacks?: boolean;
  destructor?: boolean;
  updateHook?: boolean;
}

type managerAPIVersion = '3.4' | '3.13';

export function capabilities(
  managerAPI: managerAPIVersion,
  options: OptionalCapabilities = {}
): Capabilities {
  assert(
    'Invalid component manager compatibility specified',
    managerAPI === '3.4' || managerAPI === '3.13'
  );

  let updateHook = true;

  if (EMBER_CUSTOM_COMPONENT_ARG_PROXY) {
    updateHook = managerAPI === '3.13' ? Boolean(options.updateHook) : true;
  }

  return {
    asyncLifeCycleCallbacks: Boolean(options.asyncLifecycleCallbacks),
    destructor: Boolean(options.destructor),
    updateHook,
  };
}

export interface DefinitionState<ComponentInstance> {
  name: string;
  ComponentClass: Factory<ComponentInstance>;
  symbolTable: ProgramSymbolTable;
  template?: any;
}

export interface Capabilities {
  asyncLifeCycleCallbacks: boolean;
  destructor: boolean;
  updateHook: boolean;
}

// TODO: export ICapturedArgumentsValue from glimmer and replace this
export interface Args {
  named: Dict<Opaque>;
  positional: Opaque[];
}

export interface ManagerDelegate<ComponentInstance> {
  capabilities: Capabilities;
  createComponent(factory: Opaque, args: Args): ComponentInstance;
  updateComponent(instance: ComponentInstance, args: Args): void;
  getContext(instance: ComponentInstance): Opaque;
}

export function hasAsyncLifeCycleCallbacks<ComponentInstance>(
  delegate: ManagerDelegate<ComponentInstance>
): delegate is ManagerDelegateWithAsyncLifeCycleCallbacks<ComponentInstance> {
  return delegate.capabilities.asyncLifeCycleCallbacks;
}

export interface ManagerDelegateWithAsyncLifeCycleCallbacks<ComponentInstance>
  extends ManagerDelegate<ComponentInstance> {
  didCreateComponent(instance: ComponentInstance): void;
  didUpdateComponent(instance: ComponentInstance): void;
}

export function hasDestructors<ComponentInstance>(
  delegate: ManagerDelegate<ComponentInstance>
): delegate is ManagerDelegateWithDestructors<ComponentInstance> {
  return delegate.capabilities.destructor;
}

export interface ManagerDelegateWithDestructors<ComponentInstance>
  extends ManagerDelegate<ComponentInstance> {
  destroyComponent(instance: ComponentInstance): void;
}

export interface ComponentArguments {
  positional: Opaque[];
  named: Dict<Opaque>;
}

/**
  The CustomComponentManager allows addons to provide custom component
  implementations that integrate seamlessly into Ember. This is accomplished
  through a delegate, registered with the custom component manager, which
  implements a set of hooks that determine component behavior.

  To create a custom component manager, instantiate a new CustomComponentManager
  class and pass the delegate as the first argument:

  ```js
  let manager = new CustomComponentManager({
    // ...delegate implementation...
  });
  ```

  ## Delegate Hooks

  Throughout the lifecycle of a component, the component manager will invoke
  delegate hooks that are responsible for surfacing those lifecycle changes to
  the end developer.

  * `create()` - invoked when a new instance of a component should be created
  * `update()` - invoked when the arguments passed to a component change
  * `getContext()` - returns the object that should be
*/
export default class CustomComponentManager<ComponentInstance>
  extends AbstractComponentManager<
    CustomComponentState<ComponentInstance>,
    CustomComponentDefinitionState<ComponentInstance>
  >
  implements
    WithStaticLayout<
      CustomComponentState<ComponentInstance>,
      CustomComponentDefinitionState<ComponentInstance>,
      OwnedTemplateMeta,
      RuntimeResolver
    > {
  create(
    _env: Environment,
    definition: CustomComponentDefinitionState<ComponentInstance>,
    args: Arguments
  ): CustomComponentState<ComponentInstance> {
    const { delegate } = definition;
    const capturedArgs = args.capture();

    let value;
    let namedArgsProxy = {};

    if (EMBER_CUSTOM_COMPONENT_ARG_PROXY) {
      if (HAS_NATIVE_PROXY) {
        let handler: ProxyHandler<{}> = {
          get(_target, prop) {
            if (capturedArgs.named.has(prop as string)) {
              let ref = capturedArgs.named.get(prop as string);
              consume(ref.tag);

              return ref.value();
            }
          },

          has(_target, prop) {
            return capturedArgs.named.has(prop as string);
          },

          ownKeys(_target) {
            return capturedArgs.named.names;
          },

          getOwnPropertyDescriptor(_target, prop) {
            assert(
              'args proxies do not have real property descriptors, so you should never need to call getOwnPropertyDescriptor yourself. This code exists for enumerability, such as in for-in loops and Object.keys()',
              capturedArgs.named.has(prop as string)
            );

            return {
              enumerable: true,
              configurable: true,
            };
          },
        };

        if (DEBUG) {
          handler.set = function(_target, prop) {
            assert(
              `You attempted to set ${definition.ComponentClass.class}#${String(
                prop
              )} on a components arguments. Component arguments are immutable and cannot be updated directly, they always represent the values that are passed to your component. If you want to set default values, you should use a getter instead`
            );

            return false;
          };
        }

        namedArgsProxy = new Proxy(namedArgsProxy, handler);
      } else {
        capturedArgs.named.names.forEach(name => {
          Object.defineProperty(namedArgsProxy, name, {
            enumerable: true,
            configurable: true,
            get() {
              let ref = capturedArgs.named.get(name);
              consume(ref.tag);

              return ref.value();
            },
          });
        });
      }

      ARGS_PROXY_TAGS.set(namedArgsProxy, capturedArgs.named);

      value = {
        named: namedArgsProxy,
        positional: capturedArgs.positional.value(),
      };
    } else {
      value = capturedArgs.value();
    }

    const component = delegate.createComponent(definition.ComponentClass.class, value);

    return new CustomComponentState(delegate, component, capturedArgs, namedArgsProxy);
  }

  update({ delegate, component, args, namedArgsProxy }: CustomComponentState<ComponentInstance>) {
    let value;

    if (EMBER_CUSTOM_COMPONENT_ARG_PROXY) {
      value = {
        named: namedArgsProxy!,
        positional: args.positional.value(),
      };
    } else {
      value = args.value();
    }

    delegate.updateComponent(component, value);
  }

  didCreate({ delegate, component }: CustomComponentState<ComponentInstance>) {
    if (hasAsyncLifeCycleCallbacks(delegate)) {
      delegate.didCreateComponent(component);
    }
  }

  didUpdate({ delegate, component }: CustomComponentState<ComponentInstance>) {
    if (hasAsyncLifeCycleCallbacks(delegate)) {
      delegate.didUpdateComponent(component);
    }
  }

  getContext({ delegate, component }: CustomComponentState<ComponentInstance>) {
    delegate.getContext(component);
  }

  getSelf({ delegate, component }: CustomComponentState<ComponentInstance>): PathReference<Opaque> {
    return RootReference.create(delegate.getContext(component));
  }

  getDestructor(state: CustomComponentState<ComponentInstance>): Option<Destroyable> {
    if (hasDestructors(state.delegate)) {
      return state;
    } else {
      return null;
    }
  }

  getCapabilities({
    delegate,
  }: CustomComponentDefinitionState<ComponentInstance>): ComponentCapabilities {
    return Object.assign({}, CAPABILITIES, {
      updateHook: delegate.capabilities.updateHook,
    });
  }

  getTag({ args }: CustomComponentState<ComponentInstance>): Tag {
    return args.tag;
  }

  didRenderLayout() {}

  getLayout(state: DefinitionState<ComponentInstance>): Invocation {
    return {
      handle: state.template.asLayout().compile(),
      symbolTable: state.symbolTable!,
    };
  }
}
const CUSTOM_COMPONENT_MANAGER = new CustomComponentManager();

/**
 * Stores internal state about a component instance after it's been created.
 */
export class CustomComponentState<ComponentInstance> {
  constructor(
    public delegate: ManagerDelegate<ComponentInstance>,
    public component: ComponentInstance,
    public args: CapturedArguments,
    public namedArgsProxy?: {}
  ) {}

  destroy() {
    const { delegate, component } = this;

    if (hasDestructors(delegate)) {
      delegate.destroyComponent(component);
    }
  }
}

export interface CustomComponentDefinitionState<ComponentInstance>
  extends DefinitionState<ComponentInstance> {
  delegate: ManagerDelegate<ComponentInstance>;
}

export class CustomManagerDefinition<ComponentInstance> implements ComponentDefinition {
  public state: CustomComponentDefinitionState<ComponentInstance>;
  public symbolTable: ProgramSymbolTable;
  public manager: CustomComponentManager<
    ComponentInstance
  > = CUSTOM_COMPONENT_MANAGER as CustomComponentManager<ComponentInstance>;

  constructor(
    public name: string,
    public ComponentClass: Factory<ComponentInstance>,
    public delegate: ManagerDelegate<ComponentInstance>,
    public template: OwnedTemplate
  ) {
    const layout = template.asLayout();
    const symbolTable = layout.symbolTable;
    this.symbolTable = symbolTable;

    this.state = {
      name,
      ComponentClass,
      template,
      symbolTable,
      delegate,
    };
  }
}
