var async = require('async');
var plugins = require('../plugins');
var db = require('../database');

var rewards = module.exports;

rewards.save = (data, callback) => {
	async.each(data, function save(data, next) {
		if (!Object.keys(data.rewards).length) {
			return next();
		}

		var rewardsData = data.rewards;
		delete data.rewards;

		async.waterfall([
			(next) => {
				if (!parseInt(data.id, 10)) {
					db.incrObjectField('global', 'rewards:id', next);
				} else {
					next(null, data.id);
				}
			},
			(rid, next) => {
				data.id = rid;

				async.series([
					(next) => {
						rewards.delete(data, next);
					},
					(next) => {
						db.setAdd('rewards:list', data.id, next);
					},
					(next) => {
						db.setObject('rewards:id:' + data.id, data, next);
					},
					(next) => {
						db.setObject('rewards:id:' + data.id + ':rewards', rewardsData, next);
					},
				], next);
			},
		], next);
	}, (err) => {
		if (err) {
			return callback(err);
		}

		saveConditions(data, callback);
	});
};

rewards.delete = (data, callback) => {
	async.parallel([
		(next) => {
			db.setRemove('rewards:list', data.id, next);
		},
		(next) => {
			db.delete('rewards:id:' + data.id, next);
		},
		(next) => {
			db.delete('rewards:id:' + data.id + ':rewards', next);
		},
	], callback);
};

rewards.get = (callback) => {
	async.parallel({
		active: getActiveRewards,
		conditions: (next) => {
			plugins.fireHook('filter:rewards.conditions', [], next);
		},
		conditionals: (next) => {
			plugins.fireHook('filter:rewards.conditionals', [], next);
		},
		rewards: (next) => {
			plugins.fireHook('filter:rewards.rewards', [], next);
		},
	}, callback);
};

function saveConditions(data, callback) {
	var rewardsPerCondition = {};
	async.waterfall([
		(next) => {
			db.delete('conditions:active', next);
		},
		(next) => {
			var conditions = [];

			data.forEach((reward) => {
				conditions.push(reward.condition);
				rewardsPerCondition[reward.condition] = rewardsPerCondition[reward.condition] || [];
				rewardsPerCondition[reward.condition].push(reward.id);
			});

			db.setAdd('conditions:active', conditions, next);
		},
		(next) => {
			async.each(Object.keys(rewardsPerCondition), (condition, next) => {
				db.setAdd('condition:' + condition + ':rewards', rewardsPerCondition[condition], next);
			}, next);
		},
	], (err) => {
		callback(err);
	});
}

function getActiveRewards(callback) {
	var activeRewards = [];

	function load(id, next) {
		async.parallel({
			main: (next) => {
				db.getObject('rewards:id:' + id, next);
			},
			rewards: (next) => {
				db.getObject('rewards:id:' + id + ':rewards', next);
			},
		}, (err, data) => {
			if (data.main) {
				data.main.disabled = data.main.disabled === 'true';
				data.main.rewards = data.rewards;
				activeRewards.push(data.main);
			}

			next(err);
		});
	}

	db.getSetMembers('rewards:list', (err, rewards) => {
		if (err) {
			return callback(err);
		}

		async.eachSeries(rewards, load, (err) => {
			callback(err, activeRewards);
		});
	});
}
