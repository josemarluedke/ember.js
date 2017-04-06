import { moduleFor, ApplicationTestCase } from 'internal-test-helpers';

import { RSVP, Controller } from 'ember-runtime';
import { Route, NoneLocation } from 'ember-routing';
import { run } from 'ember-metal';
import { compile } from 'ember-template-compiler';
import { Application, Resolver } from 'ember-application';
import { jQuery } from 'ember-views';
import { setTemplates, setTemplate } from 'ember-glimmer';

let Router, App, templates, router, container, counter;

function step(expectedValue, description) {
  equal(counter, expectedValue, 'Step ' + expectedValue + ': ' + description);
  counter++;
}

// function bootApplication(startingURL) {
  // for (let name in templates) {
    // setTemplate(name, compile(templates[name]));
  // }

  // if (startingURL) {
    // NoneLocation.reopen({
      // path: startingURL
    // });
  // }

  // startingURL = startingURL || '';
  // router = container.lookup('router:main');
  // run(App, 'advanceReadiness');
// }



moduleFor('Loading/Error Substates', class extends ApplicationTestCase {

  constructor() {
    super();
    counter = 1;

    // templates = {
      // application: '<div id="app">{{outlet}}</div>',
      // index: 'INDEX',
      // loading: 'LOADING',
      // bro: 'BRO',
      // sis: 'SIS'
    // };


    this.addTemplate('application', '<div id="app">{{outlet}}</div>');
    // this.addTemplate('index', 'INDEX');
  }

  ['@test Slow promise from a child route of application enters nested loading state'](assert) {
    assert.expect(4);
    this.addTemplate('bro', 'BRO');
    this.addTemplate('loading', 'LOADING');

    let broModel = {};
    let broDeferred = RSVP.defer();

    this.router.map(function() {
      this.route('bro');
    });

    this.add('route:application', Route.extend({
      setupController() {
        step(2, 'ApplicationRoute#setup');
      }
    }));

    this.add('route:bro', Route.extend({
      model() {
        step(1, 'BroRoute#model');
        return broDeferred.promise;
      }
    }));

    run(() => this.visit('/bro'));

    assert.equal(this.$('#app').text(), 'LOADING', 'The Loading template is nested in application template\'s outlet');

    run(broDeferred, 'resolve', broModel);

    assert.equal(this.$('#app').text(), 'BRO', 'bro template has loaded and replaced loading template');
  }

  ['@test Slow promises waterfall on startup'](assert) {
    assert.expect(7);

    let grandmaDeferred = RSVP.defer();
    let sallyDeferred = RSVP.defer();

    this.router.map(function() {
      this.route('grandma', function() {
        this.route('mom', { resetNamespace: true }, function() {
          this.route('sally');
        });
      });
    });

    this.addTemplate('loading', 'LOADING');
    this.addTemplate('grandma', 'GRANDMA {{outlet}}');
    this.addTemplate('mom', 'MOM {{outlet}}');
    this.addTemplate('mom.loading', 'MOMLOADING');
    this.addTemplate('mom.sally', 'SALLY');

    this.add('route:grandma', Route.extend({
      model() {
        step(1, 'GrandmaRoute#model');
        return grandmaDeferred.promise;
      }
    }));

    this.add('route:mom', Route.extend({
      model() {
        step(2, 'Mom#model');
        return {};
      }
    }));

    // App.MomSallyRoute =
    this.add('route:mom.sally', Route.extend({
      model() {
        step(3, 'SallyRoute#model');
        return sallyDeferred.promise;
      },
      setupController() {
        step(4, 'SallyRoute#setupController');
      }
    }));

    run(() => this.visit('/grandma/mom/sally'));

    assert.equal(this.$('#app').text(), 'LOADING', 'The Loading template is nested in application template\'s outlet');

    run(grandmaDeferred, 'resolve', {});
    assert.equal(this.$('#app').text(), 'GRANDMA MOM MOMLOADING', 'Mom\'s child loading route is displayed due to sally\'s slow promise');

    run(sallyDeferred, 'resolve', {});
    assert.equal(this.$('#app').text(), 'GRANDMA MOM SALLY', 'Sally template displayed');
  }


  ['@test ApplicationRoute#currentPath reflects loading state path'](assert) {
    assert.expect(4);

    let momDeferred = RSVP.defer();

    this.router.map(function() {
      this.route('grandma', function() {
        this.route('mom');
      });
    });

    // this.addTemplate('loading', 'LOADING');
    this.addTemplate('grandma', 'GRANDMA {{outlet}}');
    this.addTemplate('grandma.loading', 'GRANDMALOADING');
    this.addTemplate('grandma.mom', 'MOM');

    this.add('route:grandma.mom', Route.extend({
      model() {
        return momDeferred.promise;
      }
    }));

    let instance;
    run(() => this.visit('/grandma/mom'));

    equal(this.$('#app').text(), 'GRANDMA GRANDMALOADING');

    // let appController = this.application.__container__.lookup('controller:application');
    let appController = this.applicationInstance.lookup('controller:application');
    equal(appController.get('currentPath'), 'grandma.loading', 'currentPath reflects loading state');

    run(momDeferred, 'resolve', {});
    equal(this.$('#app').text(), 'GRANDMA MOM');
    equal(appController.get('currentPath'), 'grandma.mom', 'currentPath reflects final state');
  }

  ['@test Slow promises returned from ApplicationRoute#model don\'t enter LoadingRoute'](assert) {
    assert.expect(2);

    let appDeferred = RSVP.defer();

    this.addTemplate('index', 'INDEX');
    this.add('route:application', Route.extend({
      model() {
        return appDeferred.promise;
      }
    }));

    this.add('route:loading', Route.extend({
      setupController() {
        assert.ok(false, 'shouldn\'t get here');
      }
    }));

    run(() => this.visit('/'));

    assert.equal(this.$('#app').text(), '', 'nothing has been rendered yet');

    run(appDeferred, 'resolve', {});
    assert.equal(this.$('#app').text(), 'INDEX', 'renders the index template');
  }

  ['@test Don\'t enter loading route unless either route or template defined'](assert) {
    assert.expect(2);

    let indexDeferred = RSVP.defer();

    this.add('controller:application', Controller.extend());

    this.addTemplate('index', 'INDEX');
    this.add('route:index', Route.extend({
      model() {
        return indexDeferred.promise;
      }
    }));

    run(() => this.visit('/'));

    let appController = this.applicationInstance.lookup('controller:application');
    assert.ok(appController.get('currentPath') !== 'loading', 'loading state not entered');

    run(indexDeferred, 'resolve', {});
    assert.equal(this.$('#app').text(), 'INDEX');
  }

  ['@test Enter loading route if only LoadingRoute defined'](assert) {
    assert.expect(4);

    let indexDeferred = RSVP.defer();

    this.addTemplate('index', 'INDEX');
    this.add('route:index', Route.extend({
      model() {
        step(1, 'IndexRoute#model');
        return indexDeferred.promise;
      }
    }));

    this.add('route:loading', Route.extend({
      setupController() {
        step(2, 'LoadingRoute#setupController');
      }
    }));

    run(() => this.visit('/'));

    let appController = container.lookup('controller:application');
    assert.equal(appController.get('currentPath'), 'loading', 'loading state entered');

    run(indexDeferred, 'resolve', {});
    assert.equal(this.$('#app').text(), 'INDEX');
  }

});













// QUnit.module('Loading/Error Substates', {
  // setup() {
    // counter = 1;

    // run(function() {
      // App = Application.create({
        // name: 'App',
        // rootElement: '#qunit-fixture',
        // // fake a modules resolver
        // Resolver: Resolver.extend({ moduleBasedResolver: true })
      // });

      // App.deferReadiness();

      // App.Router.reopen({
        // location: 'none'
      // });

      // Router = App.Router;

      // container = App.__container__;

    // });
  // },

  // teardown() {
    // run(function() {
      // App.destroy();
      // App = null;

      // setTemplates({});
    // });

    // NoneLocation.reopen({
      // path: ''
    // });
  // }
// });


QUnit.test('Enter child loading state of pivot route', function() {
  expect(4);

  let deferred = RSVP.defer();

  Router.map(function() {
    this.route('grandma', function() {
      this.route('mom', { resetNamespace: true }, function() {
        this.route('sally');
      });
      this.route('smells');
    });
  });

  templates['grandma/loading'] = 'GMONEYLOADING';

  App.ApplicationController = Controller.extend();

  App.MomSallyRoute = Route.extend({
    setupController() {
      step(1, 'SallyRoute#setupController');
    }
  });

  App.GrandmaSmellsRoute = Route.extend({
    model() {
      return deferred.promise;
    }
  });

  bootApplication('/grandma/mom/sally');

  let appController = container.lookup('controller:application');
  equal(appController.get('currentPath'), 'grandma.mom.sally', 'Initial route fully loaded');

  run(router, 'transitionTo', 'grandma.smells');
  equal(appController.get('currentPath'), 'grandma.loading', 'in pivot route\'s child loading state');

  run(deferred, 'resolve', {});

  equal(appController.get('currentPath'), 'grandma.smells', 'Finished transition');
});

QUnit.test('Loading actions bubble to root, but don\'t enter substates above pivot', function() {
  expect(6);

  delete templates.loading;

  let sallyDeferred = RSVP.defer();
  let smellsDeferred = RSVP.defer();

  Router.map(function() {
    this.route('grandma', function() {
      this.route('mom', { resetNamespace: true }, function() {
        this.route('sally');
      });
      this.route('smells');
    });
  });

  App.ApplicationController = Controller.extend();

  App.ApplicationRoute = Route.extend({
    actions: {
      loading(transition, route) {
        ok(true, 'loading action received on ApplicationRoute');
      }
    }
  });

  App.MomSallyRoute = Route.extend({
    model() {
      return sallyDeferred.promise;
    }
  });

  App.GrandmaSmellsRoute = Route.extend({
    model() {
      return smellsDeferred.promise;
    }
  });

  bootApplication('/grandma/mom/sally');

  let appController = container.lookup('controller:application');
  ok(!appController.get('currentPath'), 'Initial route fully loaded');
  run(sallyDeferred, 'resolve', {});

  equal(appController.get('currentPath'), 'grandma.mom.sally', 'transition completed');

  run(router, 'transitionTo', 'grandma.smells');
  equal(appController.get('currentPath'), 'grandma.mom.sally', 'still in initial state because the only loading state is above the pivot route');

  run(smellsDeferred, 'resolve', {});

  equal(appController.get('currentPath'), 'grandma.smells', 'Finished transition');
});

QUnit.test('Default error event moves into nested route', function() {
  expect(6);

  templates['grandma'] = 'GRANDMA {{outlet}}';
  templates['grandma/error'] = 'ERROR: {{model.msg}}';

  Router.map(function() {
    this.route('grandma', function() {
      this.route('mom', { resetNamespace: true }, function() {
        this.route('sally');
      });
    });
  });

  App.ApplicationController = Controller.extend();

  App.MomSallyRoute = Route.extend({
    model() {
      step(1, 'MomSallyRoute#model');

      return RSVP.reject({
        msg: 'did it broke?'
      });
    },
    actions: {
      error() {
        step(2, 'MomSallyRoute#actions.error');
        return true;
      }
    }
  });

  throws(function() {
    bootApplication('/grandma/mom/sally');
  }, function(err) { return err.msg === 'did it broke?';});

  step(3, 'App finished booting');

  equal(jQuery('#app', '#qunit-fixture').text(), 'GRANDMA ERROR: did it broke?', 'error bubbles');

  let appController = container.lookup('controller:application');
  equal(appController.get('currentPath'), 'grandma.error', 'Initial route fully loaded');
});

QUnit.test('Error events that aren\'t bubbled don\t throw application assertions', function() {
  expect(2);

  templates['grandma'] = 'GRANDMA {{outlet}}';

  Router.map(function() {
    this.route('grandma', function() {
      this.route('mom', { resetNamespace: true }, function() {
        this.route('sally');
      });
    });
  });

  App.ApplicationController =
  Controller.extend();

  App.MomSallyRoute = Route.extend({
    model() {
      step(1, 'MomSallyRoute#model');

      return RSVP.reject({
        msg: 'did it broke?'
      });
    },
    actions: {
      error(err) {
        equal(err.msg, 'did it broke?');
        return false;
      }
    }
  });

  bootApplication('/grandma/mom/sally');
});

QUnit.test('Non-bubbled errors that re-throw aren\'t swallowed', function() {
  expect(2);

  templates['grandma'] = 'GRANDMA {{outlet}}';

  Router.map(function() {
    this.route('grandma', function() {
      this.route('mom', { resetNamespace: true }, function() {
        this.route('sally');
      });
    });
  });

  App.ApplicationController = Controller.extend();

  App.MomSallyRoute = Route.extend({
    model() {
      step(1, 'MomSallyRoute#model');

      return RSVP.reject({
        msg: 'did it broke?'
      });
    },
    actions: {
      error(err) {
        // returns undefined which is falsey
        throw err;
      }
    }
  });

  throws(function() {
    bootApplication('/grandma/mom/sally');
  }, function(err) { return err.msg === 'did it broke?';});
});

QUnit.test('Handled errors that re-throw aren\'t swallowed', function() {
  expect(4);

  let handledError;

  templates['grandma'] = 'GRANDMA {{outlet}}';

  Router.map(function() {
    this.route('grandma', function() {
      this.route('mom', { resetNamespace: true }, function() {
        this.route('sally');
        this.route('this-route-throws');
      });
    });
  });

  App.ApplicationController = Controller.extend();

  App.MomSallyRoute = Route.extend({
    model() {
      step(1, 'MomSallyRoute#model');

      return RSVP.reject({
        msg: 'did it broke?'
      });
    },
    actions: {
      error(err) {
        step(2, 'MomSallyRoute#error');

        handledError = err;

        this.transitionTo('mom.this-route-throws');

        // Marks error as handled
        return false;
      }
    }
  });

  App.MomThisRouteThrowsRoute = Route.extend({
    model() {
      step(3, 'MomThisRouteThrows#model');

      throw handledError;
    }
  });

  throws(function() {
    bootApplication('/grandma/mom/sally');
  }, function(err) { return err.msg === 'did it broke?'; });
});

QUnit.test('Handled errors that bubble can be handled at a higher level', function() {
  expect(4);

  let handledError;

  templates['grandma'] = 'GRANDMA {{outlet}}';

  Router.map(function() {
    this.route('grandma', function() {
      this.route('mom', { resetNamespace: true }, function() {
        this.route('sally');
      });
    });
  });

  App.ApplicationController = Controller.extend();

  App.MomRoute = Route.extend({
    actions: {
      error(err) {
        step(3, 'MomRoute#error');

        equal(err, handledError, 'error handled and rebubbled is handleable at heigher route');
      }
    }
  });

  App.MomSallyRoute = Route.extend({
    model() {
      step(1, 'MomSallyRoute#model');

      return RSVP.reject({
        msg: 'did it broke?'
      });
    },

    actions: {
      error(err) {
        step(2, 'MomSallyRoute#error');

        handledError = err;

        return true;
      }
    }
  });

  bootApplication('/grandma/mom/sally');
});

QUnit.test('errors that are bubbled are thrown at a higher level if not handled', function() {
  expect(3);

  templates['grandma'] = 'GRANDMA {{outlet}}';

  Router.map(function() {
    this.route('grandma', function() {
      this.route('mom', { resetNamespace: true }, function() {
        this.route('sally');
      });
    });
  });

  App.ApplicationController = Controller.extend();

  App.MomSallyRoute = Route.extend({
    model() {
      step(1, 'MomSallyRoute#model');

      return RSVP.reject({
        msg: 'did it broke?'
      });
    },

    actions: {
      error(err) {
        step(2, 'MomSallyRoute#error');
        return true;
      }
    }
  });

  throws(
    function() {
      bootApplication('/grandma/mom/sally');
    },
    function(err) {
      return err.msg === 'did it broke?';
    },
    'Correct error was thrown'
  );
});

QUnit.test('Handled errors that are thrown through rejection aren\'t swallowed', function() {
  expect(4);

  let handledError;

  templates['grandma'] = 'GRANDMA {{outlet}}';

  Router.map(function() {
    this.route('grandma', function() {
      this.route('mom', { resetNamespace: true }, function() {
        this.route('sally');
        this.route('this-route-throws');
      });
    });
  });

  App.ApplicationController = Controller.extend();

  App.MomSallyRoute = Route.extend({
    model() {
      step(1, 'MomSallyRoute#model');

      return RSVP.reject({
        msg: 'did it broke?'
      });
    },
    actions: {
      error(err) {
        step(2, 'MomSallyRoute#error');

        handledError = err;

        this.transitionTo('mom.this-route-throws');

        // Marks error as handled
        return false;
      }
    }
  });

  App.MomThisRouteThrowsRoute = Route.extend({
    model() {
      step(3, 'MomThisRouteThrows#model');

      return RSVP.reject(handledError);
    }
  });

  throws(function() {
    bootApplication('/grandma/mom/sally');
  }, function(err) { return err.msg === 'did it broke?'; });
});

QUnit.test('Setting a query param during a slow transition should work', function() {
  let deferred = RSVP.defer();

  Router.map(function() {
    this.route('grandma', { path: '/grandma/:seg' },  function() { });
  });

  templates['grandma/loading'] = 'GMONEYLOADING';

  App.ApplicationController = Controller.extend();

  App.IndexRoute = Route.extend({
    beforeModel: function() {
      this.transitionTo('grandma', 1);
    }
  });

  App.GrandmaRoute = Route.extend({
    queryParams: {
      test: { defaultValue: 1 }
    }
  });

  App.GrandmaIndexRoute = Route.extend({
    model() {
      return deferred.promise;
    }
  });

  bootApplication('/');

  let appController = container.lookup('controller:application');
  let grandmaController = container.lookup('controller:grandma');

  equal(appController.get('currentPath'), 'grandma.loading', 'Initial route should be loading');

  run(function() {
    grandmaController.set('test', 3);
  });

  equal(appController.get('currentPath'), 'grandma.loading', 'Route should still be loading');
  equal(grandmaController.get('test'), 3, 'Controller query param value should have changed');

  run(deferred, 'resolve', {});

  equal(appController.get('currentPath'), 'grandma.index', 'Transition should be complete');
});

QUnit.test('Slow promises returned from ApplicationRoute#model enter ApplicationLoadingRoute if present', function() {
  expect(2);

  let appDeferred = RSVP.defer();

  App.ApplicationRoute = Route.extend({
    model() {
      return appDeferred.promise;
    }
  });

  let loadingRouteEntered = false;
  App.ApplicationLoadingRoute = Route.extend({
    setupController() {
      loadingRouteEntered = true;
    }
  });

  bootApplication();

  ok(loadingRouteEntered, 'ApplicationLoadingRoute was entered');

  run(appDeferred, 'resolve', {});
  equal(jQuery('#app', '#qunit-fixture').text(), 'INDEX');
});

QUnit.test('Slow promises returned from ApplicationRoute#model enter application_loading if template present', function() {
  expect(3);

  templates['application_loading'] = '<div id="toplevel-loading">TOPLEVEL LOADING</div>';

  let appDeferred = RSVP.defer();
  App.ApplicationRoute = Route.extend({
    model() {
      return appDeferred.promise;
    }
  });

  bootApplication();

  equal(jQuery('#qunit-fixture #toplevel-loading').text(), 'TOPLEVEL LOADING');

  run(appDeferred, 'resolve', {});

  equal(jQuery('#toplevel-loading', '#qunit-fixture').length, 0, 'top-level loading View has been entirely removed from DOM');
  equal(jQuery('#app', '#qunit-fixture').text(), 'INDEX');
});

QUnit.test('Default error event moves into nested route, prioritizing more specifically named error route', function() {
  expect(6);

  templates['grandma'] = 'GRANDMA {{outlet}}';
  templates['grandma/error'] = 'ERROR: {{model.msg}}';
  templates['mom_error'] = 'MOM ERROR: {{model.msg}}';

  Router.map(function() {
    this.route('grandma', function() {
      this.route('mom', { resetNamespace: true }, function() {
        this.route('sally');
      });
    });
  });

  App.ApplicationController = Controller.extend();

  App.MomSallyRoute = Route.extend({
    model() {
      step(1, 'MomSallyRoute#model');

      return RSVP.reject({
        msg: 'did it broke?'
      });
    },
    actions: {
      error() {
        step(2, 'MomSallyRoute#actions.error');
        return true;
      }
    }
  });

  throws(function() {
    bootApplication('/grandma/mom/sally');
  }, function(err) { return err.msg === 'did it broke?'; });

  step(3, 'App finished booting');

  equal(jQuery('#app', '#qunit-fixture').text(), 'GRANDMA MOM ERROR: did it broke?', 'the more specifically-named mom error substate was entered over the other error route');

  let appController = container.lookup('controller:application');
  equal(appController.get('currentPath'), 'grandma.mom_error', 'Initial route fully loaded');
});

QUnit.test('Prioritized substate entry works with preserved-namespace nested routes', function() {
  expect(2);

  templates['foo/bar_loading'] = 'FOOBAR LOADING';
  templates['foo/bar/index'] = 'YAY';

  Router.map(function() {
    this.route('foo', function() {
      this.route('bar', { path: '/bar' }, function() {
      });
    });
  });

  App.ApplicationController = Controller.extend();

  let deferred = RSVP.defer();
  App.FooBarRoute = Route.extend({
    model() {
      return deferred.promise;
    }
  });

  bootApplication('/foo/bar');

  equal(jQuery('#app', '#qunit-fixture').text(), 'FOOBAR LOADING', 'foo.bar_loading was entered (as opposed to something like foo/foo/bar_loading)');

  run(deferred, 'resolve');

  equal(jQuery('#app', '#qunit-fixture').text(), 'YAY');
});

QUnit.test('Prioritized substate entry works with reset-namespace nested routes', function() {
  expect(2);

  templates['bar_loading'] = 'BAR LOADING';
  templates['bar/index'] = 'YAY';

  Router.map(function() {
    this.route('foo', function() {
      this.route('bar', { path: '/bar', resetNamespace: true }, function() {
      });
    });
  });

  App.ApplicationController = Controller.extend();

  let deferred = RSVP.defer();
  App.BarRoute = Route.extend({
    model() {
      return deferred.promise;
    }
  });

  bootApplication('/foo/bar');

  equal(jQuery('#app', '#qunit-fixture').text(), 'BAR LOADING', 'foo.bar_loading was entered (as opposed to something like foo/foo/bar_loading)');

  run(deferred, 'resolve');

  equal(jQuery('#app', '#qunit-fixture').text(), 'YAY');
});

QUnit.test('Prioritized loading substate entry works with preserved-namespace nested routes', function() {
  expect(2);

  templates['foo/bar_loading'] = 'FOOBAR LOADING';
  templates['foo/bar'] = 'YAY';

  Router.map(function() {
    this.route('foo', function() {
      this.route('bar');
    });
  });

  App.ApplicationController = Controller.extend();

  let deferred = RSVP.defer();
  App.FooBarRoute = Route.extend({
    model() {
      return deferred.promise;
    }
  });

  bootApplication('/foo/bar');

  equal(jQuery('#app', '#qunit-fixture').text(), 'FOOBAR LOADING', 'foo.bar_loading was entered (as opposed to something like foo/foo/bar_loading)');

  run(deferred, 'resolve');

  equal(jQuery('#app', '#qunit-fixture').text(), 'YAY');
});

QUnit.test('Prioritized error substate entry works with preserved-namespace nested routes', function() {
  expect(2);

  templates['foo/bar_error'] = 'FOOBAR ERROR: {{model.msg}}';
  templates['foo/bar'] = 'YAY';

  Router.map(function() {
    this.route('foo', function() {
      this.route('bar');
    });
  });

  App.ApplicationController = Controller.extend();

  App.FooBarRoute = Route.extend({
    model() {
      return RSVP.reject({
        msg: 'did it broke?'
      });
    }
  });

  throws(function() {
    bootApplication('/foo/bar');
  }, function(err) { return err.msg === 'did it broke?'; });

  equal(jQuery('#app', '#qunit-fixture').text(), 'FOOBAR ERROR: did it broke?', 'foo.bar_error was entered (as opposed to something like foo/foo/bar_error)');
});

QUnit.test('Prioritized loading substate entry works with auto-generated index routes', function() {
  expect(2);

  templates['foo/index_loading'] = 'FOO LOADING';
  templates['foo/index'] = 'YAY';
  templates['foo'] = '{{outlet}}';

  Router.map(function() {
    this.route('foo', function() {
      this.route('bar');
    });
  });

  App.ApplicationController = Controller.extend();

  let deferred = RSVP.defer();
  App.FooIndexRoute = Route.extend({
    model() {
      return deferred.promise;
    }
  });
  App.FooRoute = Route.extend({
    model() {
      return true;
    }
  });

  bootApplication('/foo');

  equal(jQuery('#app', '#qunit-fixture').text(), 'FOO LOADING', 'foo.index_loading was entered');

  run(deferred, 'resolve');

  equal(jQuery('#app', '#qunit-fixture').text(), 'YAY');
});

QUnit.test('Prioritized error substate entry works with auto-generated index routes', function() {
  expect(2);

  templates['foo/index_error'] = 'FOO ERROR: {{model.msg}}';
  templates['foo/index'] = 'YAY';
  templates['foo'] = '{{outlet}}';

  Router.map(function() {
    this.route('foo', function() {
      this.route('bar');
    });
  });

  App.ApplicationController = Controller.extend();

  App.FooIndexRoute = Route.extend({
    model() {
      return RSVP.reject({
        msg: 'did it broke?'
      });
    }
  });
  App.FooRoute = Route.extend({
    model() {
      return true;
    }
  });

  throws(() => bootApplication('/foo'),
         err => err.msg === 'did it broke?');

  equal(jQuery('#app', '#qunit-fixture').text(), 'FOO ERROR: did it broke?', 'foo.index_error was entered');
});

QUnit.test('Rejected promises returned from ApplicationRoute transition into top-level application_error', function() {
  expect(3);

  templates['application_error'] = '<p id="toplevel-error">TOPLEVEL ERROR: {{model.msg}}</p>';

  let reject = true;
  App.ApplicationRoute = Route.extend({
    model() {
      if (reject) {
        return RSVP.reject({ msg: 'BAD NEWS BEARS' });
      } else {
        return {};
      }
    }
  });

  throws(() => bootApplication(),
        err => err.msg === 'BAD NEWS BEARS');

  equal(jQuery('#toplevel-error', '#qunit-fixture').text(), 'TOPLEVEL ERROR: BAD NEWS BEARS');

  reject = false;
  run(router, 'transitionTo', 'index');

  equal(jQuery('#app', '#qunit-fixture').text(), 'INDEX');
});
