module c_tb;
    logic clk;
    initial begin
        clk = 0;
        #10 $finish;
    end
endmodule
