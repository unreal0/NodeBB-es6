

var eventEmitter = new (require('events')).EventEmitter();


eventEmitter.all = (events, callback) => {
	var eventList = events.slice(0);

	events.forEach(function onEvent(event) {
		eventEmitter.on(event, () => {
			var index = eventList.indexOf(event);
			if (index === -1) {
				return;
			}
			eventList.splice(index, 1);
			if (eventList.length === 0) {
				callback();
			}
		});
	});
};

eventEmitter.any = (events, callback) => {
	events.forEach(function onEvent(event) {
		eventEmitter.on(event, () => {
			if (events !== null) {
				callback();
			}

			events = null;
		});
	});
};

module.exports = eventEmitter;
