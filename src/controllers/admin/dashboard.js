

var async = require('async');
var nconf = require('nconf');

var db = require('../../database');
var meta = require('../../meta');
var plugins = require('../../plugins');

var dashboardController = module.exports;

dashboardController.get = (req, res, next) => {
	async.waterfall([
		(next) => {
			async.parallel({
				stats: (next) => {
					getStats(next);
				},
				notices: (next) => {
					var notices = [
						{
							done: !meta.reloadRequired,
							doneText: '[[admin/general/dashboard:restart-not-required]]',
							notDoneText: '[[admin/general/dashboard:restart-required]]',
						},
						{
							done: plugins.hasListeners('filter:search.query'),
							doneText: '[[admin/general/dashboard:search-plugin-installed]]',
							notDoneText: '[[admin/general/dashboard:search-plugin-not-installed]]',
							tooltip: '[[admin/general/dashboard:search-plugin-tooltip]]',
							link: '/admin/extend/plugins',
						},
					];

					if (global.env !== 'production') {
						notices.push({
							done: false,
							notDoneText: '[[admin/general/dashboard:running-in-development]]',
						});
					}

					plugins.fireHook('filter:admin.notices', notices, next);
				},
			}, next);
		},
		(results) => {
			res.render('admin/general/dashboard', {
				version: nconf.get('version'),
				notices: results.notices,
				stats: results.stats,
				canRestart: !!process.send,
			});
		},
	], next);
};

function getStats(callback) {
	async.waterfall([
		(next) => {
			async.parallel([
				(next) => {
					getStatsForSet('ip:recent', 'uniqueIPCount', next);
				},
				(next) => {
					getStatsForSet('users:joindate', 'userCount', next);
				},
				(next) => {
					getStatsForSet('posts:pid', 'postCount', next);
				},
				(next) => {
					getStatsForSet('topics:tid', 'topicCount', next);
				},
			], next);
		},
		(results, next) => {
			results[0].name = '[[admin/general/dashboard:unique-visitors]]';
			results[1].name = '[[admin/general/dashboard:users]]';
			results[2].name = '[[admin/general/dashboard:posts]]';
			results[3].name = '[[admin/general/dashboard:topics]]';

			next(null, results);
		},
	], callback);
}

function getStatsForSet(set, field, callback) {
	var terms = {
		day: 86400000,
		week: 604800000,
		month: 2592000000,
	};

	var now = Date.now();
	async.parallel({
		day: (next) => {
			db.sortedSetCount(set, now - terms.day, '+inf', next);
		},
		week: (next) => {
			db.sortedSetCount(set, now - terms.week, '+inf', next);
		},
		month: (next) => {
			db.sortedSetCount(set, now - terms.month, '+inf', next);
		},
		alltime: (next) => {
			getGlobalField(field, next);
		},
	}, callback);
}

function getGlobalField(field, callback) {
	db.getObjectField('global', field, (err, count) => {
		callback(err, parseInt(count, 10) || 0);
	});
}
