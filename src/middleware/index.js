var async = require('async');
var path = require('path');
var fs = require('fs');
var csrf = require('csurf');
var validator = require('validator');
var nconf = require('nconf');
var ensureLoggedIn = require('connect-ensure-login');
var toobusy = require('toobusy-js');
var Benchpress = require('benchpressjs');
var LRU = require('lru-cache');

var plugins = require('../plugins');
var meta = require('../meta');
var user = require('../user');
var groups = require('../groups');
var file = require('../file');

var analytics = require('../analytics');

var controllers = {
	api: require('./../controllers/api'),
	helpers: require('../controllers/helpers'),
};

var delayCache = LRU({
	maxAge: 1000 * 60,
});

var middleware = module.exports;

middleware.applyCSRF = csrf();

middleware.ensureLoggedIn = ensureLoggedIn.ensureLoggedIn(nconf.get('relative_path') + '/login');

require('./admin')(middleware);
require('./header')(middleware);
require('./render')(middleware);
require('./maintenance')(middleware);
require('./user')(middleware);
require('./headers')(middleware);

middleware.stripLeadingSlashes = (req, res, next) => {
	var target = req.originalUrl.replace(nconf.get('relative_path'), '');
	if (target.startsWith('//')) {
		res.redirect(nconf.get('relative_path') + target.replace(/^\/+/, '/'));
	} else {
		setImmediate(next);
	}
};

middleware.pageView = (req, res, next) => {
	analytics.pageView({
		ip: req.ip,
		path: req.path,
		uid: req.uid,
	});

	plugins.fireHook('action:middleware.pageView', { req: req });

	if (req.user) {
		user.updateLastOnlineTime(req.user.uid);
		if (req.path.startsWith('/api/users') || req.path.startsWith('/users')) {
			user.updateOnlineUsers(req.user.uid, next);
		} else {
			user.updateOnlineUsers(req.user.uid);
			next();
		}
	} else {
		next();
	}
};


middleware.pluginHooks = (req, res, next) => {
	async.each(plugins.loadedHooks['filter:router.page'] || [], function (hookObj, next) {
		hookObj.method(req, res, next);
	}, (err) => {
		// If it got here, then none of the subscribed hooks did anything, or there were no hooks
		next(err);
	});
};

middleware.validateFiles = (req, res, next) => {
	if (!Array.isArray(req.files.files) || !req.files.files.length) {
		return next(new Error(['[[error:invalid-files]]']));
	}

	next();
};

middleware.prepareAPI = (req, res, next) => {
	res.locals.isAPI = true;
	next();
};

middleware.routeTouchIcon = (req, res) => {
	if (meta.config['brand:touchIcon'] && validator.isURL(meta.config['brand:touchIcon'])) {
		return res.redirect(meta.config['brand:touchIcon']);
	}
	var iconPath = '../../public';
	if (meta.config['brand:touchIcon']) {
		iconPath += meta.config['brand:touchIcon'].replace(/assets\/uploads/, 'uploads');
	} else {
		iconPath += '/logo.png';
	}
	return res.sendFile(path.join(__dirname, iconPath), {
		maxAge: req.app.enabled('cache') ? 5184000000 : 0,
	});
};

middleware.privateTagListing = (req, res, next) => {
	if (!req.user && parseInt(meta.config.privateTagListing, 10) === 1) {
		controllers.helpers.notAllowed(req, res);
	} else {
		next();
	}
};

middleware.exposeGroupName = (req, res, next) => {
	expose('groupName', groups.getGroupNameByGroupSlug, 'slug', req, res, next);
};

middleware.exposeUid = (req, res, next) => {
	expose('uid', user.getUidByUserslug, 'userslug', req, res, next);
};

function expose(exposedField, method, field, req, res, next) {
	if (!req.params.hasOwnProperty(field)) {
		return next();
	}
	async.waterfall([
		(next) => {
			method(req.params[field], next);
		},
		(id, next) => {
			res.locals[exposedField] = id;
			next();
		},
	], next);
}

middleware.privateUploads = (req, res, next) => {
	if (req.user || parseInt(meta.config.privateUploads, 10) !== 1) {
		return next();
	}
	if (req.path.startsWith(nconf.get('relative_path') + '/assets/uploads/files')) {
		return res.status(403).json('not-allowed');
	}
	next();
};

middleware.busyCheck = (req, res, next) => {
	if (global.env === 'production' && (!meta.config.hasOwnProperty('eventLoopCheckEnabled') || parseInt(meta.config.eventLoopCheckEnabled, 10) === 1) && toobusy()) {
		analytics.increment('errors:503');
		res.status(503).type('text/html').sendFile(path.join(__dirname, '../../public/503.html'));
	} else {
		next();
	}
};

middleware.applyBlacklist = (req, res, next) => {
	meta.blacklist.test(req.ip, (err) => {
		next(err);
	});
};

middleware.processTimeagoLocales = (req, res, next) => {
	var fallback = req.path.indexOf('-short') === -1 ? 'jquery.timeago.en.js' : 'jquery.timeago.en-short.js';
	var localPath = path.join(__dirname, '../../public/vendor/jquery/timeago/locales', req.path);

	async.waterfall([
		(next) => {
			file.exists(localPath, next);
		},
		(exists, next) => {
			if (exists) {
				next(null, localPath);
			} else {
				next(null, path.join(__dirname, '../../public/vendor/jquery/timeago/locales', fallback));
			}
		},
		(path) => {
			res.status(200).sendFile(path, {
				maxAge: req.app.enabled('cache') ? 5184000000 : 0,
			});
		},
	], next);
};

middleware.delayLoading = (req, res, next) => {
	// Introduces an artificial delay during load so that brute force attacks are effectively mitigated

	// Add IP to cache so if too many requests are made, subsequent requests are blocked for a minute
	var timesSeen = delayCache.get(req.ip) || 0;
	if (timesSeen > 10) {
		return res.sendStatus(429);
	}
	delayCache.set(req.ip, timesSeen += 1);

	setTimeout(next, 1000);
};

var viewsDir = nconf.get('views_dir');
var workingCache = {};

middleware.templatesOnDemand = (req, res, next) => {
	var filePath = req.filePath || path.join(viewsDir, req.path);
	if (!filePath.endsWith('.js')) {
		return next();
	}

	if (workingCache[filePath]) {
		workingCache[filePath].push(next);
		return;
	}

	async.waterfall([
		(cb) => {
			file.exists(filePath, cb);
		},
		(exists, cb) => {
			if (exists) {
				return next();
			}

			// need to check here again
			// because compilation could have started since last check
			if (workingCache[filePath]) {
				workingCache[filePath].push(next);
				return;
			}

			workingCache[filePath] = [next];
			fs.readFile(filePath.replace(/\.js$/, '.tpl'), 'utf8', cb);
		},
		(source, cb) => {
			Benchpress.precompile({
				source: source,
				minify: global.env !== 'development',
			}, cb);
		},
		(compiled, cb) => {
			fs.writeFile(filePath, compiled, cb);
		},
	], (err) => {
		var arr = workingCache[filePath];
		workingCache[filePath] = null;

		arr.forEach((callback) => {
			callback(err);
		});
	});
};
