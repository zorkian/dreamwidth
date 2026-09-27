#!/usr/bin/perl
#

package S2::BackendPerl;

use strict;
use S2::Indenter;

sub new {
    my ($class, $l, $layerID, $untrusted, $oo, $sourcename) = @_;
    my $this = {
        'layer' => $l,
        'layerID' => $layerID,
        'untrusted' => $untrusted,
        'package' => '',
        'oo' => $oo,
        'sourcename' => $sourcename,
    };
    bless $this, $class;
}

sub getBuiltinPackage { shift->{'package'}; }
sub setBuiltinPackage { my $t = shift; $t->{'package'} = shift; }

sub getLayerID { shift->{'layerID'}; }
sub getLayerIDString { shift->{'layerID'}; }

sub untrusted { shift->{'untrusted'}; }

sub oo { shift->{oo}; }

sub output {
    my ($this, $o) = @_;
    my $io = new S2::Indenter $o, 4;

    $io->writeln("#!/usr/bin/perl");
    $io->writeln("# auto-generated Perl code from input S2 code"); 
    if ($this->oo) {
        $io->writeln("use S2::Runtime::OO;");
        $io->writeln("use strict;");
        $io->writeln('my $lay = new S2::Runtime::OO::Layer;');
        $io->writeln('$lay->set_source_name('.$this->quoteString($this->{sourcename}).');');
        my $nodes = $this->{'layer'}->getNodes();
        foreach my $n (@$nodes) {
            $n->asPerl($this, $io);
        }
        $io->writeln('$lay;');
    }
    else {
        $io->writeln("package S2;");
        $io->writeln("use strict;");
        $io->writeln("register_layer($this->{'layerID'});");
        my $nodes = $this->{'layer'}->getNodes();
        foreach my $n (@$nodes) {
            $n->asPerl($this, $io);
        }
        $io->writeln("1;");
        $io->writeln("# end.");
    }
}

# Opt-in position collection executes the normal emitter on the same checked AST.
# Local wrappers only record output positions; native bytes and legacy output stay unchanged.
sub collectNativePositions {
    my ($this, $o) = @_;
    my @classes = map { "S2::$_" } qw(NodeExprStmt NodeVarDeclStmt NodePrintStmt
        NodeReturnStmt NodePushStmt NodeDeleteStmt NodeBranchStmt NodeIfStmt
        NodeWhileStmt NodeForStmt NodeForeachStmt NodeStmtBlock NodeFunction NodeArrayLiteral);
    my $install;
    $install = sub {
        my ($at) = @_;
        return $this->output($o) if $at == @classes;
        my $class = $classes[$at];
        my $original = $class->can('asPerl');
        return $install->($at + 1) unless $original;
        no strict 'refs';
        no warnings 'redefine';
        local *{"${class}::asPerl"} = sub {
            my ($node, $bp, $writer, @rest) = @_;
            my $line = $writer->lineNumber;
            $node->{native_physical_line} = $line;
            $node->{native_cop_line} = $line;
            my $offset = length ${$o->[0]};
            $original->($node, $bp, $writer, @rest);
            $node->{native_first_value_line} = $line + 1 if $class eq 'S2::NodeArrayLiteral' && @{$node->{vals}};
            if ($class eq 'S2::NodeFunction') {
                my $chunk = substr(${$o->[0]}, $offset);
                if ($chunk =~ /S2::check_depth\(\) if \+\+\$S2::sub_ctr/) {
                    my $prefix = substr($chunk, 0, $-[0]);
                    $node->{native_entry_line} = $line + ($prefix =~ tr/\n/\n/);
                }
            }
            if ($class eq 'S2::NodeForeachStmt') {
                my $expr=$node->{listexpr};
                while (ref($expr) && ($expr->{expr} || $expr->{subExpr})) {
                    $expr=$expr->{expr} || $expr->{subExpr};
                }
                $node->{native_physical_line}=$node->{native_cop_line}=$expr->{native_first_value_line}
                    if ref($expr) && $expr->isa('S2::NodeArrayLiteral') && $expr->{native_first_value_line};
            }

        };
        return $install->($at + 1);
    };
    $install->(0);
    # Physical positions are immutable inputs. Resolve sharing in execution order,
    # after the complete unchanged native emission, so outer shares reach children.
    my ($statement, $block);
    my $void_call = sub {
        my ($node) = @_;
        return 0 unless $node->isa('S2::NodeExprStmt');
        my $expr = $node->{expr};
        $expr = $expr->{expr} while ref($expr) eq 'S2::NodeExpr';
        return ref($expr) && $expr->isa('S2::NodeTerm') &&
            ($expr->{type} == $S2::NodeTerm::FUNCCALL ||
             $expr->{type} == $S2::NodeTerm::METHCALL);
    };
    $block = sub {
        my ($body, $share, $force, $direct_sub) = @_;
        my $last = $body->{native_physical_line};
        my $list = $body->{stmtlist};
        for my $node (@$list) {
            my $single = @$list == 1;
            my $override = $single && (defined($force) ||
                (defined($share) && $void_call->($node))) ? ($force // $share) : undef;
            my $nested_share = $single && $node->isa('S2::NodeIfStmt') ? $share : undef;
            $last = $statement->($node, $override, $nested_share,
                $direct_sub && $node == $list->[-1] && $node->isa('S2::NodeIfStmt'));
        }
        return $last;
    };
    $statement = sub {
        my ($node, $override, $inherited_share, $terminal) = @_;
        my $effective = $override // $node->{native_physical_line};
        $node->{native_cop_line} = $effective;
        if ($node->isa('S2::NodeIfStmt')) {
            $block->($node->{thenblock}, $inherited_share // $effective);
            # Native Perl 5.34 has a static direct-sub-final special case;
            # neither runtime value context nor nested terminal status propagates.
            my $then = $node->{thenblock}{stmtlist};
            my $elsif_share = $terminal && @$then == 1
                ? $then->[0]{native_physical_line} : $effective;
            $block->($_, $elsif_share) for @{$node->{elseifblocks}};
            $block->($node->{elseblock}) if $node->{elseblock};
            return $effective;
        }
        if ($node->isa('S2::NodeForStmt')) {
            $block->($node->{stmts}, undef, $effective);
        } elsif ($node->isa('S2::NodeWhileStmt') || $node->isa('S2::NodeForeachStmt')) {
            $block->($node->{stmts});
        } elsif ($node->isa('S2::NodeStmtBlock')) {
            return $block->($node);
        }
        return $effective;
    };
    for my $node (@{$this->{layer}->getNodes()}) {
        $block->($node->{stmts}, undef, undef, 1) if $node->isa('S2::NodeFunction') && $node->{stmts};
    }
}

sub quoteString {
    shift if ref $_[0];
    my $s = shift;
    return "\"" . quoteStringInner($s) . "\"";
}

sub quoteStringInner {
    my $s = shift;
    $s =~ s/([\\\$\"\@])/\\$1/g;
    $s =~ s/\n/\\n/g;
    return $s;
}


1;
