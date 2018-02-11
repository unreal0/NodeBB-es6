var async = require('async');
var plugins = require('../plugins');
var db = require('../database');
var translator = require('../translator');
var pubsub = require('../pubsub');

var admin = module.exports;
admin.cache = null;

pubsub.on('admin:navigation:save', () => {
	admin.cache = null;
});

admin.save = (data, callback) => {
	var order = Object.keys(data);
	var items = data.map((item, idx) => {
		var data = {};

		for (var i in item) {
			if (item.hasOwnProperty(i)) {
				item[i] = typeof item[i] === 'string' ? translator.escape(item[i]) : item[i];
			}
		}

		data[idx] = item;
		return JSON.stringify(data);
	});

	admin.cache = null;
	pubsub.publish('admin:navigation:save');
	async.waterfall([
		(next) => {
			db.delete('navigation:enabled', next);
		},
		(next) => {
			db.sortedSetAdd('navigation:enabled', order, items, next);
		},
	], callback);
};

admin.getAdmin = (callback) => {
	async.parallel({
		enabled: admin.get,
		available: getAvailable,
	}, callback);
};

admin.get = (callback) => {
	async.waterfall([
		(next) => {
			db.getSortedSetRange('navigation:enabled', 0, -1, next);
		},
		(data, next) => {
			data = data.map((item, idx) => JSON.parse(item)[idx]);

			next(null, data);
		},
	], callback);
};

function getAvailable(callback) {
	var core = require('../../install/data/navigation.json').map((item) => {
		item.core = true;
		return item;
	});

	plugins.fireHook('filter:navigation.available', core, callback);
}
