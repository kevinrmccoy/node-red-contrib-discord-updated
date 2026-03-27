const helper = require('node-red-node-test-helper');
const sinon = require('sinon');
require('should');
require('should-sinon');

const discordReactionManager = require('../discord/discordReactionManager');
const discordToken = require('../discord/discord-token');
const discordBotManager = require('../discord/lib/discordBotManager');

helper.init(require.resolve('node-red'));

function mockCollection(entries) {
  const map = new Map(entries);
  map.map = function (fn) { return [...this.values()].map(fn); };
  return map;
}

describe('discordReactionManager Node', function () {
  let getBotStub;
  let bot;
  let collector;
  let messageObject;
  let channelInstance;

  const flow = [
    { id: 'n1', type: 'discordReactionManager', name: 'reactions', token: 't1', wires: [['n2']] },
    { id: 't1', type: 'discord-token', name: 'token' },
    { id: 'n2', type: 'helper' },
  ];

  beforeEach(function () {
    collector = {
      on: sinon.stub(),
      stop: sinon.stub(),
    };
    messageObject = {
      createReactionCollector: sinon.stub().returns(collector),
    };
    channelInstance = {
      messages: { fetch: sinon.stub().resolves(messageObject) },
    };
    bot = {
      channels: { fetch: sinon.stub().resolves(channelInstance) },
    };
    getBotStub = sinon.stub(discordBotManager, 'getBot').resolves(bot);
  });

  afterEach(function () {
    helper.unload();
    sinon.restore();
  });

  it('stops listening when msg.stop is true for a tracked message', function (done) {
    helper.load([discordToken, discordReactionManager], flow, function () {
      const node = helper.getNode('n1');

      // First: start a collector for message 'msg-123'
      node.receive({ channel: 'chan-1', message: 'msg-123' });

      setImmediate(function () {
        // Verify collector was created
        messageObject.createReactionCollector.should.be.calledOnce();

        // Now send stop for that message
        node.receive({ stop: true, message: 'msg-123' });

        setImmediate(function () {
          try {
            collector.stop.should.be.calledOnce();
            done();
          } catch (err) {
            done(err);
          }
        });
      });
    });
  });

  it('does nothing when msg.stop is true for an unknown message', function (done) {
    helper.load([discordToken, discordReactionManager], flow, function () {
      const node = helper.getNode('n1');

      node.receive({ stop: true, message: 'unknown-msg' });

      setImmediate(function () {
        try {
          collector.stop.should.not.be.called();
          done();
        } catch (err) {
          done(err);
        }
      });
    });
  });

  it('creates a collector when msg.stop is not set', function (done) {
    helper.load([discordToken, discordReactionManager], flow, function () {
      const node = helper.getNode('n1');

      node.receive({ channel: 'chan-1', message: 'msg-456' });

      setImmediate(function () {
        try {
          messageObject.createReactionCollector.should.be.calledOnce();
          done();
        } catch (err) {
          done(err);
        }
      });
    });
  });

  it('emits a start message when a collector is created', function (done) {
    helper.load([discordToken, discordReactionManager], flow, function () {
      const helperNode = helper.getNode('n2');
      const node = helper.getNode('n1');

      helperNode.on('input', function (msg) {
        try {
          msg.should.have.property('type', 'start');
          msg.should.have.property('payload', 600000);
          msg.should.have.property('message', 'msg-456');
          msg.should.have.property('channel', 'chan-1');
          done();
        } catch (err) {
          done(err);
        }
      });

      node.receive({ channel: 'chan-1', message: 'msg-456' });
    });
  });

  it('emits an end message with reason timeout', function (done) {
    helper.load([discordToken, discordReactionManager], flow, function () {
      const helperNode = helper.getNode('n2');
      const node = helper.getNode('n1');

      node.receive({ channel: 'chan-1', message: 'msg-456' });

      setImmediate(function () {
        try {
          // Find the 'end' callback registered on the collector
          const endCall = collector.on.getCalls().find(c => c.args[0] === 'end');
          endCall.should.be.ok();
          const endCallback = endCall.args[1];

          helperNode.on('input', function (msg) {
            try {
              if (msg.type !== 'end') return; // skip the start message
              msg.should.have.property('payload', 'timeout');
              msg.should.have.property('type', 'end');
              msg.should.have.property('collected').eql({});
              msg.should.have.property('message', 'msg-456');
              msg.should.have.property('channel', 'chan-1');
              done();
            } catch (err) {
              done(err);
            }
          });

          // Simulate the collector ending due to time
          endCallback(mockCollection([]), 'time');
        } catch (err) {
          done(err);
        }
      });
    });
  });

  it('falls back to msg.message.channelId when msg.channel is not set', function (done) {
    helper.load([discordToken, discordReactionManager], flow, function () {
      const node = helper.getNode('n1');

      node.receive({ message: { id: 'msg-789', channelId: 'chan-from-msg' } });

      setImmediate(function () {
        try {
          bot.channels.fetch.should.be.calledWith('chan-from-msg');
          messageObject.createReactionCollector.should.be.calledOnce();
          done();
        } catch (err) {
          done(err);
        }
      });
    });
  });

  it('emits channel on collect events', function (done) {
    helper.load([discordToken, discordReactionManager], flow, function () {
      const helperNode = helper.getNode('n2');
      const node = helper.getNode('n1');

      node.receive({ channel: 'chan-1', message: 'msg-456' });

      setImmediate(function () {
        try {
          const collectCall = collector.on.getCalls().find(c => c.args[0] === 'collect');
          collectCall.should.be.ok();
          const collectCallback = collectCall.args[1];

          bot.users = { fetch: sinon.stub().resolves({ id: 'author-1' }) };

          helperNode.on('input', function (msg) {
            try {
              if (msg.type !== 'set') return;
              msg.should.have.property('channel', 'chan-1');
              done();
            } catch (err) {
              done(err);
            }
          });

          collectCallback(
            { _emoji: { name: '👍' }, count: 1, message: { author: { id: 'author-1' }, toJSON: () => ({}) } },
            { fetch: sinon.stub().resolves({ id: 'reactor-1', toJSON: () => ({}) }) }
          );
        } catch (err) {
          done(err);
        }
      });
    });
  });

  it('emits channel on remove events', function (done) {
    helper.load([discordToken, discordReactionManager], flow, function () {
      const helperNode = helper.getNode('n2');
      const node = helper.getNode('n1');

      node.receive({ channel: 'chan-1', message: 'msg-456' });

      setImmediate(function () {
        try {
          const removeCall = collector.on.getCalls().find(c => c.args[0] === 'remove');
          removeCall.should.be.ok();
          const removeCallback = removeCall.args[1];

          bot.users = { fetch: sinon.stub().resolves({ id: 'author-1' }) };

          helperNode.on('input', function (msg) {
            try {
              if (msg.type !== 'remove') return;
              msg.should.have.property('channel', 'chan-1');
              done();
            } catch (err) {
              done(err);
            }
          });

          removeCallback(
            { _emoji: { name: '👍' }, count: 0, message: { author: { id: 'author-1' }, toJSON: () => ({}) } },
            { fetch: sinon.stub().resolves({ id: 'reactor-1', toJSON: () => ({}) }) }
          );
        } catch (err) {
          done(err);
        }
      });
    });
  });

  it('emits an end message with reason commanded', function (done) {
    helper.load([discordToken, discordReactionManager], flow, function () {
      const helperNode = helper.getNode('n2');
      const node = helper.getNode('n1');

      node.receive({ channel: 'chan-1', message: 'msg-456' });

      setImmediate(function () {
        try {
          const endCall = collector.on.getCalls().find(c => c.args[0] === 'end');
          endCall.should.be.ok();
          const endCallback = endCall.args[1];

          helperNode.on('input', function (msg) {
            try {
              if (msg.type !== 'end') return;
              msg.should.have.property('payload', 'commanded');
              msg.should.have.property('type', 'end');
              msg.should.have.property('collected').eql({ '👍': 3, '👎': 1 });
              msg.should.have.property('message', 'msg-456');
              msg.should.have.property('channel', 'chan-1');
              done();
            } catch (err) {
              done(err);
            }
          });

          // Simulate the collector being stopped manually with reactions
          const coll = mockCollection([
            ['👍', { emoji: { name: '👍' }, count: 3 }],
            ['👎', { emoji: { name: '👎' }, count: 1 }],
          ]);
          endCallback(coll, 'user');
        } catch (err) {
          done(err);
        }
      });
    });
  });
});
