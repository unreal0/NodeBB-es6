var helpers = module.exports;

helpers.setupPageRoute = (router, name, middleware, middlewares, controller) => {
	middlewares = [middleware.maintenanceMode, middleware.registrationComplete, middleware.pageView, middleware.pluginHooks].concat(middlewares);

	router.get(name, middleware.busyCheck, middleware.buildHeader, middlewares, controller);
	router.get('/api' + name, middlewares, controller);
};

helpers.setupAdminPageRoute = (router, name, middleware, middlewares, controller) => {
	router.get(name, middleware.admin.buildHeader, middlewares, controller);
	router.get('/api' + name, middlewares, controller);
};
