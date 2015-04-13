
// based on: http://tutorialzine.com/2013/04/services-chooser-backbone-js/

$(function(){

    ///// UTILS ///////////////////////////////////////////////////////////////
    var dayFormat = function(m) {
        return moment(m).format('YYYY-MM-DD'); // e.g. 2015-02-15
    };
    var weekFormat = function(m) {
        // TODO: Let the user change the current goal cycle without affecting
        // past goal periods.  Can probably wait for GR5.
        return moment(m).format('GGGG-[W]W'); // e.g. 2015-W7
    };

    ///// MODEL ///////////////////////////////////////////////////////////////
    //
    var DURATION_GRANULARITY = 5;
    var Session = Backbone.Model.extend({
        defaults: {
            date: moment(),
            duration: 30,
            label: 'unspecified',
        },
        initialize: function (attrs, options) {
            // parse date
            switch(typeof attrs.date){
                case 'number':
                case 'string':
                    attrs.date = moment(attrs.date);
                    this.attributes.date = attrs.date;
                    break;
            }
            //console.log('initialized a session');
        },
        day: function() {
            return dayFormat(this.attributes.date);
        },
        week: function() {
            return weekFormat(this.attributes.date);
        }
    });

    var WeekSessions = Backbone.Collection.extend({
        model: Session
    });

    var Week = Backbone.Model.extend({
        defaults: function() {
            return {
                sessions: new Backbone.Collection()
            };
        }
    });

    // fake model
    //
    var list = [
        new Session({ date: "2015-04-01", duration: 60,   label: 'polka'}),
        new Session({ date: "2015-04-01", duration: 100,  label: 'running'}),
        new Session({ date: "2015-04-02", duration: 20,   label: 'aggressive sitting'}),
        new Session({ date: "2015-04-04", duration: 40,   label: 'laser tag'})
    ];
    for(var i = 0; i < 100; ++i){
        var m = moment("2015-04-04")
                  .subtract(Math.round(i / 3 + Math.random() * i), 'days')
                  .add(Math.round(Math.random() * 1e6), 'ms');
        list.push(new Session({ date: m, duration: Math.ceil(1 + Math.random() * 10) * 5, label: 'random'}));
    }
    list.sort(function(a, b){
        return moment(a.attributes.date) - moment(b.attributes.date) < 0;
    });
    var sessions = new Backbone.Collection(list);

    //////////////////
    // Marionette code
    //////////////////

    var DAY_HEIGHT_PX = 42;  // Keep in sync with svg {...} in main.css
    var PX_PER_MIN = 700 / 420;

    // @see http://jsfiddle.net/bryanbuchs/c72Vg/
    var WeekView = Marionette.ItemView.extend({
        template: "#weekTpl",
        initialize: function(options) {
            this.weekSessions = this.model.attributes.sessions;
            this.listenTo(this.weekSessions, 'add', this.render);
            this.listenTo(this.weekSessions, 'change', this.render);
            this.listenTo(this.weekSessions, 'remove', this.render);
            this.dragInfo = null;
        },
        onBeforeRender: function() {
            this.byDay = this.weekSessions.groupBy(function(session, i) {
                return session.day();
            });
            // cache
            this.beginning = moment(this.weekSessions.at(0).attributes.date).startOf('isoWeek');
            this.end = +moment(this.beginning).endOf('isoWeek');
            this.cumulativeSum = {};
            var day = moment(this.beginning);
            var sum = 0;
            while(+day < this.end){
                var key = dayFormat(day);
                sum += _.reduce(this.byDay[key] || [], function(sum, session) {
                    return sum + session.attributes.duration;
                }, 0);
                this.cumulativeSum[key] = sum;
                day = day.add(1, 'days');
            }
        },
        templateHelpers: function() {
            return {
                self: this,
                DAY_HEIGHT_PX: DAY_HEIGHT_PX,
                // Round so our 1px borders are aligned with the screen pixels.
                rm2p: function(min) {
                    return Math.round(PX_PER_MIN * min);
                },
                attr: function(session, name){
                    return session.attributes[name];
                },
                days: function() {
                    return [0, 1, 2, 3, 4, 5, 6];
                },
                reversedDays: function() {
                    return [6, 5, 4, 3, 2, 1, 0];
                },
                day: function(i){
                    return moment(this.self.beginning).add(i, 'days');
                },
                daySessions: function(i) {
                    var day = this.day(i);
                    return this.self.byDay[dayFormat(day)];
                },
                emptyDay: function(day) {
                    return !this.daySessions(day);
                },
                daySum: function(day, upTo) {
                    if(arguments.length < 2)
                        upTo = Infinity;
                    var sessionList = this.daySessions(day) || [];
                    return _.reduce(sessionList.slice(0, upTo), function(sum, session){
                      return sum + session.attributes.duration;
                    }, 0);
                },
                cumulative: function(i) {
                    var m = this.day(i);
                    return this.self.cumulativeSum[dayFormat(m)];
                },
                weekNumber: function(){
                    return this.self.beginning.format('W');
                }
            };
        },
        events: {
          "mousedown rect.session":     "mousedownSession",
          "mousedown rect.new-session": "mousedownPlus",
          "mousemove": "mousemove",
          "mouseup": "mouseup",
        },
        mousedownSession: function(event){
            var cid = $(event.target).data('cid');
            this.startDragging(this.weekSessions.get(cid), false, event);
        },
        mousedownPlus: function(event){
            var day = $(event.target).data('day');
            var date = this.templateHelpers().day(day);
            var newSession = new Session({date: date});
            this.weekSessions.add(newSession);
            // The view should render synchronously, so the new rect should be
            // present in the DOM if we need it.
            this.startDragging(newSession, true, event);
        },
        startDragging: function(session, isCreate, event){
            this.dragInfo = {
                    session: session,
                    isCreate: isCreate,
                    startTime: moment(),
                    origDuration: session.attributes.duration,
                    origMouseX: event.pageX};
        },
        mousemove: function(event){
            if (this.dragInfo) {
                var newDuration = Math.max(0,
                        this.dragInfo.origDuration +
                        (event.pageX - this.dragInfo.origMouseX) / PX_PER_MIN);
                newDuration = DURATION_GRANULARITY * Math.round(newDuration / DURATION_GRANULARITY);
                this.dragInfo.session.set('duration', newDuration);
            }
        },
        mouseup: function(event){
            if (this.dragInfo) {
                // XXX: Ideally this time threshold would be a system setting
                // like the double-click timeout.
                if (moment().diff(this.dragInfo.startTime, 'milliseconds') < 300) {
                    console.log('Treat as a click');
                    // TODO: If creating, prompt the user to type in the duration.
                }
                // TODO: Prompt for activity type if creating a session.
                // Delete if duration has been reduced to zero.
                if (this.dragInfo.session.attributes.duration == 0)
                    this.weekSessions.remove(this.dragInfo.session);
                this.dragInfo = null;
            }
        }
    });

    var FullView = Marionette.CollectionView.extend({
        childView: WeekView,
        initialize: function() {
            var sessionsByWeek = this.collection.groupBy(function(session, i) {
                return session.week();
            });
            /*
            var weeks = Object.keys(weekSessions);
            console.log(weeks);
            for(var w in weekSessions){
                var sessions = weekSessions[w];
                console.log('%s -> %o', w, sessions);
            }
            */
            var weeks = _.map(sessionsByWeek, function(weekSessionsArray) {
                return new Week({sessions: new WeekSessions(weekSessionsArray)});
            });
            this.collection = new Backbone.Collection(weeks);
        }
    });

    // application
    //
    var app = new Marionette.Application();
    app.addRegions({
        weekList: '#weeks'
    });
    app.on('start', function(options){
        console.log('Started Marionette application, options = %o', options);

        if(Backbone.history){
            Backbone.history.start();
        }
    });

    app.weekList.show(new FullView({collection: sessions}));

    app.start();
});
