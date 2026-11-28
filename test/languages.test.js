'use strict';
// Classes in Java, Go and Rust, read from code with no AI: methods belong to
// their type on the map, and a class shows the parts it is built from.
const test = require('node:test');
const assert = require('node:assert/strict');
const projectMap = require('../src/project/graph');
const { stepShape } = require('../src/stages/system');
const { partLayers } = require('../src/stages/layers');

const JAVA = `package nano;
/** A tiny GPT: embeddings, blocks, a head. */
@Model
public class Gpt {
  private final Embedding wte;
  private final List<Block> blocks = new ArrayList<>();
  private final LayerNorm lnF = new LayerNorm(768);
  private Linear head;
  private int calls = 0;
  public Gpt(Config cfg) {
    this.wte = new Embedding(cfg.vocab, cfg.dim);
    for (int i = 0; i < cfg.layers; i++) blocks.add(new Block(cfg));
    head = new Linear(cfg.dim, cfg.vocab);
  }
  public Tensor forward(Tensor idx) {
    Tensor x = wte.forward(idx);
    for (Block b : blocks) x = b.forward(x);
    return head.forward(lnF.forward(x));
  }
}
class Block {
  private final Attention attn;
  Block(Config cfg) { attn = new Attention(cfg); }
  Tensor forward(Tensor x) { return x.add(attn.forward(x)); }
}
// Places orders and tells the customer.
class OrderService {
  private final OrderRepository repo;
  private final Mailer mailer;
  private final Map<String, Order> pending = new HashMap<>();
  private final Clock clock;
  OrderService(DataSource db, String host, Clock clock) {
    this.repo = new OrderRepository(db);
    this.mailer = new SmtpMailer(host);
    this.clock = clock;
  }
  void place(Order order) {
    repo.save(order);
    mailer.send(order.customer(), "Thanks");
  }
}
`;

const GO = `package nano

// Model is a tiny GPT.
type Model struct {
	wte    *Embedding
	blocks []*Block
	head   *Linear
}

type ID int

// NewModel builds the model.
func NewModel(cfg Config) (*Model, error) {
	m := &Model{
		wte:  NewEmbedding(cfg.Vocab, cfg.Dim),
		head: nn.NewLinear(cfg.Dim, cfg.Vocab),
	}
	for i := 0; i < cfg.Layers; i++ {
		m.blocks = append(m.blocks, NewBlock(cfg))
	}
	return m, nil
}

func (g *Model) Forward(idx []int) []float32 {
	x := g.wte.Lookup(idx)
	for _, b := range g.blocks {
		x = b.Apply(x)
	}
	return g.head.Apply(x)
}

type Block struct{ attn *Attention }

func NewBlock(cfg Config) *Block { return &Block{attn: &Attention{heads: cfg.Heads}} }

func (b *Block) Apply(x []float32) []float32 { return b.attn.Apply(x) }
`;

const RUST = `use candle_nn::{linear, embedding, Linear, Embedding, VarBuilder};

/// A GPT block: attention then an MLP, each with a shortcut.
#[derive(Debug)]
pub struct Block {
    ln_1: LayerNorm,
    attn: CausalSelfAttention,
    mlp: Mlp,
}

impl Block {
    pub fn new(cfg: &Config, vb: VarBuilder) -> Result<Self> {
        let ln_1 = candle_nn::layer_norm(cfg.n_embd, 1e-5, vb.pp("ln_1"))?;
        let attn = CausalSelfAttention::new(cfg, vb.pp("attn"))?;
        Ok(Self { ln_1, attn, mlp: Mlp::new(cfg, vb.pp("mlp"))? })
    }
}

impl Module for Block {
    fn forward(&self, xs: &Tensor) -> Result<Tensor> {
        let xs = (xs + self.attn.forward(&self.ln_1.forward(xs)?)?)?;
        let xs = (&xs + self.mlp.forward(&xs)?)?;
        Ok(xs)
    }
}

pub struct Gpt { wte: Embedding, h: Vec<Block>, lm_head: Box<Linear> }

impl Gpt {
    pub fn load(cfg: &Config, vb: VarBuilder) -> Result<Self> {
        let wte = embedding(cfg.vocab, cfg.n_embd, vb.pp("wte"))?;
        let h = (0..cfg.n_layer).map(|i| Block::new(cfg, vb.pp(i))).collect::<Result<Vec<_>>>()?;
        Ok(Self { wte, h, lm_head: Box::new(linear(cfg.n_embd, cfg.vocab, vb.pp("lm_head"))?) })
    }
    pub fn forward(&self, idx: &Tensor) -> Result<Tensor> {
        let mut x = self.wte.forward(idx)?;
        for block in self.h.iter() { x = block.forward(&x)?; }
        let probs = candle_nn::ops::softmax(&self.lm_head.forward(&x)?, 1)?;
        Ok(probs)
    }
}

fn helper() {}
`;

const FILES = { 'Gpt.java': JAVA, 'model.go': GO, 'model.rs': RUST };
async function read() {
  const indexer = new projectMap.Indexer(), records = {}, classes = [];
  for (const [file, text] of Object.entries(FILES)) {
    records[file] = await indexer.extract(file, text);
    for (const def of records[file].defs) if (def.kind === 'class') classes.push({ file, def });
  }
  return { records, classes, out: partLayers(classes, new Map(Object.entries(FILES))) };
}
const shape = layer => layer.name + ':' + layer.type + (layer.repeat ? ' x ' + layer.repeat : '');

test('Go structs are classes, and Go and Rust methods belong to their type on the map', async () => {
  const { records } = await read();
  const defs = file => records[file].defs.map(def => [def.name, def.kind, def.owner || '']);
  assert.deepEqual(defs('model.go'), [['Model', 'class', ''], ['ID', 'type', ''], ['NewModel', 'function', ''], ['Forward', 'method', 'Model'], ['Block', 'class', ''], ['NewBlock', 'function', ''], ['Apply', 'method', 'Block']]);
  // impl Block and impl Module for Block both belong to Block; a free function does not.
  assert.deepEqual(defs('model.rs').filter(([, kind]) => kind !== 'constant'), [['Block', 'class', ''], ['new', 'method', 'Block'], ['forward', 'method', 'Block'], ['Gpt', 'class', ''], ['load', 'method', 'Gpt'], ['forward', 'method', 'Gpt'], ['helper', 'function', '']]);
  // A step on a Go method or a Rust impl function is shown as that type's method.
  const graph = { files: Object.fromEntries(Object.entries(records)) };
  assert.deepEqual(stepShape(graph, { file: 'model.go', symbol: 'Forward', line_start: 24 }), { kind: 'method', owner: 'Model', line_start: 24 });
  const forward = records['model.rs'].defs.find(def => def.name === 'forward' && def.owner === 'Gpt');
  assert.deepEqual(stepShape(graph, { file: 'model.rs', symbol: 'forward', line_start: forward.start }), { kind: 'method', owner: 'Gpt', line_start: forward.start });
  assert.equal(stepShape(graph, { file: 'model.rs', symbol: 'helper' }).kind, 'function');
});

test('Java: constructor assignments and field initializers are parts, in the order forward uses them', async () => {
  const { out } = await read();
  const gpt = out['Gpt.java#Gpt'];
  assert.deepEqual(gpt.layers.map(shape), ['wte:Embedding', 'blocks:Block x cfg.layers', 'lnF:LayerNorm', 'head:Linear']);
  assert.equal(gpt.runs, 'forward'); assert.deepEqual(gpt.inputs, ['idx']); assert.deepEqual(gpt.outputs, []);
  assert.equal(gpt.doc, 'A tiny GPT: embeddings, blocks, a head.', 'the comment above the annotation');
  assert.equal(gpt.layers[1].own, 'Gpt.java#Block', 'a repeated project class links to its own view, in the same file');
  assert.match(gpt.layers[0].plain, /lookup table/);
  // Not a model: the method using the most parts sets the order; a passed-in value and a HashMap are not parts.
  const service = out['Gpt.java#OrderService'];
  assert.equal(service.runs, 'place'); assert.deepEqual(service.layers.map(shape), ['repo:OrderRepository', 'mailer:SmtpMailer']);
  assert.equal(service.layers[0].plain, undefined, 'no ML words for a service');
});

test('Go: the NewX function fills the struct, including parts appended in a loop', async () => {
  const { out } = await read();
  const model = out['model.go#Model'];
  assert.deepEqual(model.layers.map(shape), ['wte:Embedding', 'blocks:Block x cfg.Layers', 'head:Linear']);
  assert.equal(model.runs, 'Forward'); assert.deepEqual(model.inputs, ['idx']);
  assert.equal(model.doc, 'Model is a tiny GPT.');
  assert.equal(model.layers[1].own, 'model.go#Block');
  assert.equal(model.initLine, 13, 'opens at NewModel');
  assert.deepEqual(out['model.go#Block'].layers.map(shape), ['attn:Attention'], 'a struct literal is a part too');
});

test('Rust: Self { ... } in an impl function, shorthand fields, candle helpers, repeats and wrappers', async () => {
  const { out } = await read();
  const block = out['model.rs#Block'];
  // ln_1 runs first: its call closes inside attn's call.
  assert.deepEqual(block.layers.map(shape), ['ln_1:LayerNorm', 'attn:CausalSelfAttention', 'mlp:Mlp']);
  assert.equal(block.doc, 'A GPT block: attention then an MLP, each with a shortcut.', 'the comment above #[derive]');
  assert.deepEqual(block.inputs, ['xs']);
  const gpt = out['model.rs#Gpt'];
  assert.equal(gpt.runs, 'forward');
  assert.deepEqual(gpt.layers.map(shape), ['wte:Embedding', 'h:Block x cfg.n_layer', 'lm_head:Linear', 'softmax:softmax']);
  assert.equal(gpt.layers[1].own, 'model.rs#Block');
  assert.ok(gpt.layers[3].op, 'softmax between parts is shown as math');
});
